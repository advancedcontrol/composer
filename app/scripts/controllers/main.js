'use strict';

angular.module('composerApp')
    .controller('MainCtrl', function ($conductor) {
        var system = $conductor.get('testing'),
            binding = system.bind('Lifter', 'whatwhat'),
            log = system.debug('mod-B5'),
            count = 0;

        binding.add(function (status) {
            console.log('status update:' + status);
        });

        log.add(function (output) {
            count += 1;
            console.log('debug output: ' + output);

            if (count > 5) {
                log.unbind();
                system.dump_state();
            }
        });
    });
