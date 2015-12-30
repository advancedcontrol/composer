/**
*    ACA Composer
*    An AngularJS interface for ACA Orchestrator
*    
*   Copyright (c) 2014 Advanced Control & Acoustics.
*    
*    @author     Stephen von Takach <steve@webcontrol.me>
*    @copyright  2014 webcontrol.me
* 
*     
*     References:
*        * 
*
**/


(function (angular) {
    'use strict';

    var common_headers = {
            'Content-Type': 'application/json',
            Accept: 'application/json'
        },
        GET = 'GET',
        POST = 'POST',
        PUT = 'PUT',
        DELETE = 'DELETE',
        common_crud = {
            // See defaults: http://docs.angularjs.org/api/ngResource.$resource
            get: {
                method: GET,
                headers: common_headers
            },
            query:  {
                method: GET,
                headers: common_headers
            },
            save: {
                method: POST,
                headers: common_headers
            },
            create: {
                method: POST,
                headers: common_headers
            },
            send: {
                method: POST,
                headers: common_headers
            },
            update: {
                method: PUT,
                headers: common_headers
            },
            task: {
                method: POST,
                headers: common_headers
            },
            remove: {
                method: DELETE,
                headers: common_headers
            },
            delete: {
                method: DELETE,
                headers: common_headers
            }
        };

    angular.module('Composer').

        factory('Module', ['$composer', '$resource', function ($composer, $resource) {
            return $resource($composer.http + 'api/modules/:id/:task', {
                id: '@id',
                task: '@_task'
            }, common_crud);
        }]).

        factory('SystemModule', ['$composer', '$resource', function ($composer, $resource) {
            return $resource($composer.http + 'api/systems/:sys_id/modules/:mod_id', {
                mod_id: '@module_id',
                sys_id: '@system_id'
            }, common_crud);
        }]).

        factory('Trigger', ['$composer', '$resource', function ($composer, $resource) {
            return $resource($composer.http + 'api/triggers/:id', {
                id: '@id'
            }, common_crud);
        }]).

        factory('SystemTrigger', ['$composer', '$resource', function ($composer, $resource) {
            var custom = angular.extend({}, common_crud);

            custom.query = {
                method: GET,
                headers: common_headers,
                url: $composer.http + 'api/system_triggers'
            };

            return $resource($composer.http + 'api/systems/:sys_id/triggers/:id', {
                id: '@id',
                sys_id: '@control_system_id'
            }, custom);
        }]).

        factory('System', [
            '$composer', '$resource', '$http', 'SystemTrigger',
        function ($composer, $resource, $http, Trigger) {
            var custom = angular.extend({
                    funcs: {
                        method:'GET',
                        headers: common_headers,
                        url: $composer.http + 'api/systems/:id/funcs'
                    },
                    exec: {
                        method:'POST',
                        headers: common_headers,
                        url: $composer.http + 'api/systems/:id/exec',
                        isArray: true
                    },
                    types: {
                        method:'GET',
                        headers: common_headers,
                        url: $composer.http + 'api/systems/:id/types',
                        isArray: true
                    },
                    count: {
                        method:'GET',
                        headers: common_headers,
                        url: $composer.http + 'api/systems/:id/count'
                    }
                }, common_crud),
                res = $resource($composer.http + 'api/systems/:id/:task', {
                    id: '@id',
                    task: '@_task'
                }, custom);

            res.state = function (system, params) {
                return $http.get($composer.http + 'api/systems/' + system + '/state', {
                    params: params
                });
            };

            res.prototype.add_trigger = function (data) {
                data.control_system_id = this.id;
                return Trigger.create(data);
            };

            return res;
        }]).

        factory('Dependency', ['$composer', '$resource', function ($composer, $resource) {
            return $resource($composer.http + 'api/dependencies/:id/:task', {
                id: '@id',
                task: '@_task'
            }, common_crud);
        }]).

        factory('Node', ['$composer', '$resource', function ($composer, $resource) {
            return $resource($composer.http + 'api/nodes/:id', {
                id: '@id'
            }, common_crud);
        }]).

        factory('Group', ['$composer', '$resource', function ($composer, $resource) {
            return $resource($composer.http + 'api/groups/:id', {
                id: '@id'
            }, common_crud);
        }]).

        factory('Zone', ['$composer', '$resource', function ($composer, $resource) {
            return $resource($composer.http + 'api/zones/:id', {
                id: '@id'
            }, common_crud);
        }]).

        factory('Discovery', ['$composer', '$resource', function ($composer, $resource) {
            var custom = angular.extend({
                    scan: {
                        method: 'POST',
                        headers: common_headers,
                        url: $composer.http + 'api/discovery/scan'
                    }
                }, common_crud),

                disc = $resource($composer.http + 'api/discovery/:id', {
                    id: '@id',
                }, custom);

            return disc;
        }]).

        factory('Stats', ['$composer', '$http', function ($composer, $http) {
            var makeRequest = function (type, period) {
                    var args;
                    if (period) {
                        args = {
                            params: {
                                period: period
                            }
                        };
                    }

                    return $http.get($composer.http + 'api/stats/' + type, args);
                },
                timeouts = {
                    day: 86400,
                    three_days: 259200,
                    week: 604800,
                    fortnight: 1209600,
                    month: 2592000
                };

            return {
                connections: function (period) {
                    return makeRequest('connections', period);
                },
                panels: function (period) {
                    return makeRequest('panels', period);
                },
                triggers: function (period) {
                    return makeRequest('triggers', period);
                },
                offline: function (period) {
                    return makeRequest('offline', period);
                },
                ignore_list: function () {
                    return makeRequest('ignore_list');
                },
                ignore: function (id, klass, timeout, title, reason, sys_id) {
                    var date = Math.ceil(Date.now() / 1000) + timeouts[timeout];
                    return $http.post($composer.http + 'api/stats/ignore', {
                        id: id,
                        sys_id: sys_id,
                        klass: klass,
                        timeout: date,
                        title: title,
                        reason: reason
                    });
                },
                unignore: function (id) {
                    return $http.post($composer.http + 'api/stats/ignore', {
                        id: id,
                        remove: true
                    });
                }
            };
        }]).

        factory('Log', ['$composer', '$resource', function ($composer, $resource) {
            var custom = angular.extend({
                    missing_connections: {
                        method:'GET',
                        headers: common_headers,
                        url: $composer.http + 'api/logs/missing_connections'
                    },
                    system_logs: {
                        method:'GET',
                        headers: common_headers,
                        url: $composer.http + 'api/logs/system_logs'
                    }
                }, common_crud);

            return $resource($composer.http + 'api/logs/:id', {
                id: '@id'
            }, custom);
        }]).

        factory('Authority', ['$http', '$q', function ($http, $q) {
            var authority_defer,
                auth = {};

            auth.get_authority = function () {
                if (authority_defer === undefined) {
                    authority_defer = $q.defer();

                    authority_defer.resolve($http.get('/auth/authority').then(function (authority) {
                        // If there is no application at this location then let's
                        // Throw a 404 as it is a better user experience
                        if (authority.data == null) {
                            window.location = '/404.html';
                            throw "No Authority Found!";
                        }
                        auth.authority = authority.data;
                        return authority.data;
                    }, function (err) {
                        // Some kind of error - we'll allow a retry
                        authority_defer = undefined;
                        return $q.reject(err);
                    }));
                }

                return authority_defer.promise;
            };

            return auth;
        }]).

        factory('User', ['$composer', '$resource', '$rootScope', function ($composer, $resource, $rootScope) {
            var custom = angular.extend({
                current: {
                    method:'GET',
                    headers: common_headers,
                    url: $composer.http + 'api/users/current'
                }
            }, common_crud),

            user = $resource($composer.http + 'api/users/:id', {
                id: '@id',
            }, custom),

            current_user;

            user.logged_in = function () {
                return $comms.tryAuth($composer.service);
            };

            user.get_current = function (force) {
                if (current_user === undefined || force !== undefined) {
                    current_user = user.current().$promise.then(function (user) {
                        $rootScope.currentUser = user;
                        return user;
                    });
                }

                return current_user;
            }

            return user;
        }]);

}(this.angular));
