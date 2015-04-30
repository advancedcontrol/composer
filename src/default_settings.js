(function (window, angular) {
    'use strict';

    // Polyfil location.origin
    if (!window.location.origin) {
        window.location.origin = window.location.protocol + "//" + window.location.hostname + (window.location.port ? (':' + window.location.port) : '');
    }

    var redirect_function = angular.noop;

    // Generic oauth configuration (same as signage settings.js)
    // Authentication method is the only dynamic aspect of the configuration
    angular.module('Composer')

        .config([
            '$composerProvider',
        function ($comms) {
            var redirect_uri = window.location.origin + '/oauth-resp.html';
            
            $comms.debug = true;

            $comms.useService({
                id: 'AcaEngine',
                scope: 'public',
                oauth_server: window.location.origin + '/auth/oauth/authorize',
                oauth_tokens: window.location.origin + '/auth/token',
                redirect_uri: redirect_uri,
                client_id: window.SparkMD5.hash(redirect_uri),
                api_endpoint: '/api/',
                login_redirect: function () {
                    return redirect_function();
                }
            });
        }])

        .run(['$q', 'Authority', function ($q, Authority) {
            var auth;

            Authority.get_authority().then(function (settings) {
                auth = settings;
            });

            redirect_function = function () {
                var url = encodeURIComponent(document.location.href);

                if (auth) {
                    return auth.login_url.replace('{{url}}', url);
                } else {
                    // this means we should have multiple attempts at this in case of failure
                    return Authority.get_authority().then(function (settings) {
                        auth = settings;
                        return redirect_function();
                    });
                }
            };
        }]);

} (this, this.angular));
