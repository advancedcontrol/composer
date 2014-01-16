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

    angular.module('Composer', ['ngResource']).

        // isolated circular progress bar
        provider('$composer', [function () {
            var self = this;

            this.endpoint = '/control/';

            this.$get = [function () {
                // websocket subscription management
                // rest api integration? Use resources

                // return configuration
                return {
                    endpoint: self.endpoint
                };
            }];
        }]);

}(this.angular));
