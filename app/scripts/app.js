(function (angular) {
    'use strict';
    
    angular.module('composerApp', ['Composer'])
        .config(['$composerProvider', function($composerProvider) {
            $composerProvider.port = 3000;
            $composerProvider.host = 'localhost';
        }]);
    
}(this.angular));
