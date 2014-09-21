(function (angular) {
    'use strict';

    // NOTE:: This is primarily used for development.
    //
    //  In production the interface will default to the server
    //  the files were served from and hence this configuration
    //  is not required.
    //  


    window.systemData = window.systemData || {};
    window.systemData['sys-B0'] = {
        Cam: [{power: true, $power: function (pwr) {
            this.connected = false;
        }}],
        Lights: [{}],
        Projector: [{}, {}, {}]
    };

    angular.module('Composer')
    
        // The authentication service doesn't have to be hosted on the same domain
        // as the control service - hence the complexity of this configuration
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

            // Authentication settings
            comms.useService({
                id: 'AcaEngine',
                scope: 'public',
                oauth_server: 'http://localhost:3000/auth/oauth/authorize',
                oauth_tokens: 'http://localhost:3000/auth/token',
                redirect_uri: 'http://localhost:9000/oauth-resp.html',
                client_id: 'df46d04043f6fe1d9949d9effba43b25b664064addfe4670aae8a24fe3f3f570',
                api_endpoint: 'http://localhost:3000/control/',
                proactive: true
            });
            
        }]);

}(this.angular));
