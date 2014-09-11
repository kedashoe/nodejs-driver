var assert = require('assert');
var util = require('util');
var async = require('async');

var Connection = require('../../../lib/connection.js');
var defaultOptions = require('../../../lib/client-options.js').defaultOptions;
var types = require('../../../lib/types.js');
var utils = require('../../../lib/utils.js');
var writers = require('../../../lib/writers.js');
var helper = require('../../test-helper.js');

describe('Connection', function () {
  this.timeout(30000);
  before(helper.ccmHelper.start(1));
  after(helper.ccmHelper.remove);
  describe('#open()', function () {
    it('should open', function (done) {
      var localCon = newInstance();
      localCon.open(function (err) {
        assert.ifError(err);
        assert.ok(localCon.connected && !localCon.connecting, 'Must be status connected');
        localCon.close(done);
      });
    });
    it('should fail when the host does not exits', function (done) {
      var localCon = newInstance('1.1.1.1');
      localCon.open(function (err) {
        assert.ok(err, 'Must return a connection error');
        assert.ok(!localCon.connected && !localCon.connecting);
        localCon.close(done);
      });
    });
  });
  describe('#changeKeyspace()', function () {
    it('should change active keyspace', function (done) {
      var localCon = newInstance();
      var keyspace = helper.getRandomName();
      async.series([
        localCon.open.bind(localCon),
        function creating(next) {
          var query = 'CREATE KEYSPACE ' + keyspace + ' WITH replication = {\'class\': \'SimpleStrategy\', \'replication_factor\' : 1};';
          localCon.sendStream(getRequest(query), {}, next);
        },
        function changing(next) {
          localCon.changeKeyspace(keyspace, next);
        },
        function asserting(next) {
          assert.strictEqual(localCon.keyspace, keyspace);
          next();
        }
      ], done);
    });
    it('should be case sensitive', function (done) {
      var localCon = newInstance();
      var keyspace = helper.getRandomName().toUpperCase();
      assert.notStrictEqual(keyspace, keyspace.toLowerCase());
      async.series([
        localCon.open.bind(localCon),
        function creating(next) {
          var query = 'CREATE KEYSPACE "' + keyspace + '" WITH replication = {\'class\': \'SimpleStrategy\', \'replication_factor\' : 1};';
          localCon.sendStream(getRequest(query), {}, next);
        },
        function changing(next) {
          localCon.changeKeyspace(keyspace, next);
        },
        function asserting(next) {
          assert.strictEqual(localCon.keyspace, keyspace);
          next();
        }
      ], done);
    });
  });
  describe('#execute()', function () {
    it('should queue pending if there is not an available stream id', function (done) {
      var connection = newInstance();
      async.series([
        connection.open.bind(connection),
        function asserting(seriesNext) {
          async.times(connection.maxRequests * 2, function (n, next) {
            var request = getRequest('SELECT * FROM system.schema_keyspaces');
            connection.sendStream(request, null, next);
          }, seriesNext);
        }
      ], done);
    });
    it('should callback the pending queue if the connection is there is a socket error', function (done) {
      var connection = newInstance();
      var killed = false;
      async.series([
        connection.open.bind(connection),
        function asserting(seriesNext) {
          async.times(connection.maxRequests * 2, function (n, next) {
            if (n === connection.maxRequests * 2 - 1) {
              connection.netClient.destroy();
              killed = true;
              return next();
            }
            var request = getRequest('SELECT * FROM system.schema_keyspaces');
            connection.sendStream(request, null, function (err) {
              if (killed && err) {
                assert.ok(err.isServerUnhealthy);
                err = null;
              }
              next(err);
            });
          }, seriesNext);
        }
      ], done);
    });
  });
});

function newInstance(address){
  if (!address) {
    address = helper.baseOptions.contactPoints[0];
  }
  //var logEmitter = function (name, type) { if (type === 'verbose') { return; } console.log.apply(console, arguments);};
  var logEmitter = function () {};
  var options = utils.extend({logEmitter: logEmitter}, defaultOptions);
  return new Connection(address, 2, null, options);
}

function getRequest(query) {
  return new writers.QueryWriter(query, null, null);
}