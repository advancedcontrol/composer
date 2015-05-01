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

        factory('System', ['$composer', '$resource', '$http', function ($composer, $resource, $http) {
            var custom = angular.extend({
                    'funcs': {
                        method:'GET',
                        headers: common_headers,
                        url: $composer.http + 'api/systems/:id/funcs',
                        isArray: true
                    },
                    'exec': {
                        method:'POST',
                        headers: common_headers,
                        url: $composer.http + 'api/systems/:id/exec',
                        isArray: true
                    },
                    'types': {
                        method:'GET',
                        headers: common_headers,
                        url: $composer.http + 'api/systems/:id/types',
                        isArray: true
                    },
                    'count': {
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

            return res;
        }]).

        factory('Dependency', ['$composer', '$resource', function ($composer, $resource) {
            return $resource($composer.http + 'api/dependencies/:id/:task', {
                id: '@id',
                task: '@_task'
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

        factory('Log', ['$composer', '$resource', function ($composer, $resource) {
            return $resource($composer.http + 'api/logs/:id', {
                id: '@id'
            }, common_crud);
        }]).

        factory('Authority', ['$http', '$q', function ($http, $q) {
            var authority_defer,
                auth = {};

            auth.get_authority = function () {
                if (authority_defer === undefined) {
                    authority_defer = $q.defer();

                    authority_defer.resolve($http.get('/auth/authority').then(function (authority) {
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
                'current': {
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
