var path = require('path');
var should = require('should');
var _ = require('lodash');
var Promise = require('bluebird');
var fs = Promise.promisifyAll(require('fs'));
var pcf = require('../index');
var Spec = pcf.Spec;
var helpers = require('../lib/helpers');
var proxyquire = require('proxyquire');
var sinon = require('sinon');

describe('Spec', function () {
  describe('inherit from parent spec', function () {
    // There is a city schema in both the parent and child,
    // However the schema that refers to it, is only in the parent.
    // The desired behavior is for the parent spec to still check if
    // the child has a city schema, and merge them, no matter what.
    it.only('should inherit from parent spec if the resource is not in the child', function () {
      return Spec
        .load('./test/fixtures/exampleTestingParentSpec')
        .call('renderBlueprint')
        .tap(function(blueprint){
          blueprint.indexOf('parentInherited').should.not.equal(-1);
        });
    });

    it('should keep the same order of features as in the spec.json file', function () {
      return Spec
        .load('./test/fixtures/childSpec')
        .call('renderBlueprint')
        .then(helpers.blueprintToAst)
        .tap(function (ast) {
          var names = _.pluck(ast.resourceGroups, 'name');
          var namesInCorrectOrder = ['Doodads', 'Sprockets', 'Widgets', 'Gizmos', 'Reviews'];

          names.join('\n').should.equal(namesInCorrectOrder.join('\n'));
        });
    });

    it('should check the child spec for any overridden files', function () {
      return Spec
        .load('./test/fixtures/childNestedSpec')
        .call('renderBlueprint')
        .tap(function (blueprint) {
          blueprint.indexOf('Road Runner').should.not.equal(-1);
        });
    });

    it('should override resources in the parent that are specified in the child', function () {
      // In this test a property of widget is going to be changed in the child spec.
      // This should override the setting in the parent.
      return Spec
        .load('./test/fixtures/childSpec')
        .call('renderBlueprint')
        .tap(function (blueprint) {
          blueprint.indexOf('parentOverridden').should.not.equal(-1);
        });
    });

  });
});
