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

    angular.module('Composer', ['ngResource', 'SafeApply']).

        // isolated circular progress bar
        provider('$composer', [function () {
            var self = this;

            this.endpoint = '/control/';
            this.host = undefined;
            this.port = undefined;
            this.tls = undefined;

            this.$get = ['$location', function ($location) {
                var host = self.host || $location.host(),
                    port = self.port || $location.port(),
                    http_endpoint,
                    ws_endpoint;


                // Build the endpoint URLs
                if (self.tls || $location.protocol() === 'https') {
                    http_endpoint = 'https://' + host;
                    ws_endpoint = 'wss://' + host;

                    if (port !== 443) {
                        http_endpoint += ':' + port;
                        ws_endpoint += ':' + port;
                    }
                } else {
                    http_endpoint = 'http://' + host;
                    ws_endpoint = 'ws://' + host;

                    if (port !== 80) {
                        http_endpoint += ':' + port;
                        ws_endpoint += ':' + port;
                    }
                }

                http_endpoint += self.endpoint;
                ws_endpoint += self.endpoint + 'websocket';


                // return configuration
                return {
                    endpoint: self.endpoint,
                    host: host,
                    port: port,
                    http: http_endpoint,
                    ws: ws_endpoint
                };
            }];
        }]);

}(this.angular));
