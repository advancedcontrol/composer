(function (angular) {
    'use strict';

    // NOTE:: This is primarily used for development.
    //
    //  In production the interface will default to the server
    //  the files were served from and hence this configuration
    //  is not required.
    //  


    window.systemData = window.systemData || {};
    window.systemData['System Name Here'] = {
        Cam: [{power: true, $power: function (pwr) {
            this.connected = false;
        }}],
        Lights: [{}],
        Projector: [{}, {}, {}]
    };

    angular.module('Composer')
    
        .config(['$composerProvider', function(comms) {
            // Point these variables to your ACA Engine instance
            // to start interacting with it using ACA Composer
            comms.port  = 3000;
            comms.host  = 'localhost';
            comms.tls   = false;

            // This outputs debugging information to console useful
            // if you want to see the communications occurring
            // between the interface and ACA Engine.
            comms.debug = true;
        }]);

}(this.angular));
