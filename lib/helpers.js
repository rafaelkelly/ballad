var path = require('path');
var _ = require('lodash');
var Promise = require('bluebird');
var fs = Promise.promisifyAll(require('fs'));
var exec = Promise.promisify(require('child_process').exec);
var drafter = require('drafter.js');
var parseBlueprint = Promise.promisify(require('drafter.js').parse);
var validateBlueprint = Promise.promisify(require('drafter.js').validate);
var fury = require('fury');
var minim = require('minim').namespace();
var parseResult = require('minim-parse-result');
var apiDescription = require('minim-api-description');
var apibSerializer = require('fury-adapter-apib-serializer');
var apiaryBlueprintAdapter = require('fury-adapter-apiary-blueprint-parser');
var apibParser = require('fury-adapter-apib-parser');
var matterCompilerPath = path.resolve(__dirname, '../node_modules/matter_compiler/bin/matter_compiler');

fury.use(apibSerializer);
fury.use(apibParser);
minim.use(parseResult);
// minim.use(apiDescription);

var helpers = {
  alphabetizeAST: function(ast, spec){
    ast.resourceGroups = _.sortBy(ast.resourceGroups, function(n){
      return n.name;
    });
    return ast;
  },
  //  Recursive function to merge 2 JSON objects together
  //  Recurses if a key contains an object.
  //  If a key exists in both objects, the value from the
  //  second object passed in will be used, if it exists.
  mergeJson: function (a, b) {
    if (!_.isObject(a)) {
      return b !== undefined ? b : a;
    }

    // This lets Arrays that are filled with objects be merged together.
    // This does create order dependency though, so we need to specify
    // elements in the same order as the base class
    if(_.isArray(a) && _.isArray(b)){
      if(_.every(a, _.isObject)){
        return _.merge(a,b);
      } else {
        return b? b: a;
      }
    }

    // The following 2 if statements prevent a bug that was turning
    // arrays into objects in the output.
    // We now check if an array is only in the child or parent, return that.
    if(_.isArray(b) && !a){
      return b;
    }

    if(_.isArray(a) && !b){
      return a;
    }

    var result = {};
    var keys = _.unique(_.keys(a).concat(_.keys(b)));

    // For each key in the JSON, see if it starts with '__'
    // If it does, replace the value at that key with the results of
    // merging the value at that key in the parent and child.
    _.each(keys, function (k) {
      // Added this guard clause to prevent errors
      // caused by trying to index into object b when it doesn't exist
      if (a && b){
        if (/^__/.test(k)) {
          var modifier = _.indexBy(helpers.getJsonModifiers(), 'key')[k];

          if (modifier) {
            if (modifier.mergeArgs) {
              result[k] = modifier.mergeArgs(a[k], b[k]);
              return;
            }
          }
        }

        var merged = helpers.mergeJson(a[k], b[k]);
        // This check is here for examples that have keys set to 'false'
        // Without this, the merge makes the value 'undefined' and then it's dropped from
        // the final output
        if(merged === undefined){
          if(b[k] === false){
            result[k] = b[k];
          } else {
            result[k] = a[k]
          }
        } else {
          result[k] = merged;
        }
      } else if (b) {
        result[k] = b[k];
      } else {
        result[k] = a[k];
      }
    });

    return result;
  },
  blueprintToAst: function (blueprint) {
    // Use protagonist to generate an AST from a blueprint markdown file
    return Promise.fromCallback(function (callback) {
      return drafter.validate(blueprint, {requireBlueprintname: true}, callback);
    })
      .then(function (result) {
        console.log(result);
        return parseBlueprint(blueprint, {requireBlueprintname: false})
      })
    .then(function (result) {
      var min = fury.load(result);
      console.log(JSON.stringify(result, null, 2));
      console.log(min.api.toRefract());
      return Promise.fromCallback(function (callback) {
        return fury.serialize(min, callback);
      });
    })
    .then(function (result) {
      console.log(result);
      console.log(result.api);
      return result.api.toRefract();
    })
    .tap(function (result) {
      console.log('refract1');
      console.log(result);
    });
    // .then(function (result) {
    //   console.log('hola');
    //   console.log(JSON.stringify(result.toRefract(), null, 2));
    //   return parseBlueprint(blueprint, {type: 'ast'})
    //     .get('ast')
    //     .tap(function (ast) {
    //       console.log('hola');
    //       console.log(JSON.stringify(result.toRefract(), null, 2));
    //       ast._version = '2.0';
    //     });
    // });
  },
  astToBlueprint: function (ast) {
    const min = minim.fromRefract(ast);
    console.log('refract2');
    console.log(ast);
    console.log(min);
    return Promise.fromCallback(function (callback) {
      return fury.serialize({api: min}, callback);
    });
    // var tmpFile = 'ast_' + Date.now() + '.tmp.json';
    // var cmd = matterCompilerPath + ' ' + tmpFile + ' --format json';

    // return fs
    //   .writeFileAsync(tmpFile, JSON.stringify(ast))
    //   .then(function () {
    //     return exec(cmd).get(0);
    //   })
    //   .then(function (blueprint) {
    //     return blueprint.replace(/(\{\{[a-z]+):/g, '$1');
    //   })
    //   .finally(function () {
    //     fs.unlinkAsync(tmpFile);
    //   });
  },
  mergeAst: function (child, parent) {
    if (_.isArray(child)) {
      if (_.isArray(parent)) {
        function containsOnlyObjects(array) {
          return _.every(array, _.isObject);
        }
        function indexNonAnotationElements(array) {
          return _.chain(array)
            .filter(function name(element) {
              element.element !== 'annotation'
            })
            .indexBy(function name(element) {
              return element.element + _.get(element, 'meta.title', '');
            })
            .value();
        }

        // If only child has items, return it
        if (child.length > 0 && parent.length === 0) {
          return child;
        }

        // If only parent has items, return it
        if (child.length === 0 && parent.length > 0) {
          return parent;
        }

        // If both parent and child have items, mix the arrays together based
        // on the name property of each item.
        if (containsOnlyObjects(child) && containsOnlyObjects(parent)) {
          var childIndex = indexNonAnotationElements(child);
          var parentIndex = indexNonAnotationElements(parent);
          return _.values(helpers.mergeAst(childIndex, parentIndex));
        }
      }

      return child;
    }

    if (_.isObject(child)) {
      if (_.isObject(parent)) {
        var result = _.mapValues(child, function (v, k) {
          return helpers.mergeAst(v, parent[k]);
        });

        return _.defaults(result, parent);
      }

      return child;
    }

    if (_.isString(child) && child.trim().length > 0) {
      return child;
    }

    return parent;
  },
  removeAstResources: function (resourceGroups, removalMap) {
    // Remove resources from the AST if they were specified as an
    // excluded endpoint in the spec. Returns the modified AST
    var result = [];
    var removalMapLowercase = {};

    _.each(removalMap, function (v, k) {
      removalMapLowercase[k.toLowerCase()] = v;
    });

    _.each(resourceGroups, function (group) {
      var resultGroup = _.extend({}, group);
      var resultResources = resultGroup.resources = [];

      result.push(resultGroup);

      _.each(group.resources, function (resource) {
        var key = (resource.uriTemplate || resource.name).toLowerCase();
        var removalMethods = removalMapLowercase[key];
        var resultResource = _.extend({}, resource);

        if (_.isArray(removalMethods)) {
          resultResource.actions = [];

          _.each(resource.actions, function (action) {
            if (removalMethods.indexOf(action.method) === -1) {
              resultResource.actions.push(action);
            }
          });

          //Omit the whole resource group if no actions leftover
          if (resultResource.actions.length > 0) {
            resultResources.push(resultResource);
          }
        } else if (removalMethods !== true) {
          resultResources.push(resultResource);
        }
      });
    });

    return result;
  },
  // Usage of function is for spying mergeJson during tests
  // so that function is resolved from `this` at runtime and not
  // from a reference to helpers.mergeJson in a closure.
  getJsonModifiers: function () {
    var _this = this;

    return [
      {
        key: '__extends',
        filter: function (obj, arg, ctx) {
          return ctx
            .loadJson(arg)
            .then(function (json) {
              return _this.mergeJson(json, obj);
            });
        },
        mergeArgs: function (a, b) {
          return b || a;
        }
      },
      {
        key: '__include',
        filter: _.pick,
        mergeArgs: function (a, b) {
          return [].concat(a || []).concat(b || []);
        }
      },
      {
        key: '__exclude',
        filter: _.omit,
        mergeArgs: function (a, b) {
          return [].concat(a || []).concat(b || []);
        }
      }
    ];
  }
};

module.exports = helpers;
