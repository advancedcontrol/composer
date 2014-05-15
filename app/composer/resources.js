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
                isArray: true,
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

        // supports params:
        // * system_id -> list modules in a system (no search available)
        // * dependency_id -> list modules with a particular dependency
        factory('Module', ['$composer', '$resource', function ($composer, $resource) {
            return $resource($composer.http + 'api/modules/:id/:task', {
                id: '@module_id'
            }, common_crud);
        }]).

        // Same as system_id above
        factory('SystemModule', ['$composer', '$resource', function ($composer, $resource) {
            return $resource($composer.http + 'api/systems/:sys_id/modules/:mod_id', {
                mod_id: '@module_id',
                sys_id: '@system_id'
            }, common_crud);
        }]).

        factory('System', ['$composer', '$resource', function ($composer, $resource) {
            return $resource($composer.http + 'api/systems/:id/:task', {
                id: '@system_id'
            }, common_crud);
        }]).

        // supports params:
        // * role -> list dependencies of a particular type
        factory('Dependency', ['$composer', '$resource', function ($composer, $resource) {
            return $resource($composer.http + 'api/dependencies/:id/:task', {
                id: '@dependency_id'
            }, common_crud);
        }]).

        factory('Group', ['$composer', '$resource', function ($composer, $resource) {
            return $resource($composer.http + 'api/groups/:id', {
                id: '@group_id'
            }, common_crud);
        }]).

        factory('Zone', ['$composer', '$resource', function ($composer, $resource) {
            return $resource($composer.http + 'api/zones/:id', {
                id: '@zone_id'
            }, common_crud);
        }]);

}(this.angular));
