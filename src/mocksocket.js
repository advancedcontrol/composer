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


(function (angular, debug) {
    'use strict';

    // Request ID
    var req_id = 0;

    // timers
    var SECONDS = 1000,
        RECONNECT_TIMER_SECONDS  = 5 * SECONDS,
        KEEP_ALIVE_TIMER_SECONDS = 60 * SECONDS;

    // protocol
    var PING    = 'ping',
        PONG    = 'pong',
        ERROR   = 'error',
        SUCCESS = 'success',
        NOTIFY  = 'notify',
        DEBUG   = 'debug',
        EXEC    = 'exec',
        BIND    = 'bind',
        UNBIND  = 'unbind';

    // events
    var CONNECTED_BROADCAST_EVENT    = '$conductor:connected',
        ERROR_BROADCAST_EVENT        = '$conductor:error',
        WARNING_BROADCAST_EVENT      = '$conductor:warning',
        DEFAULT_MAX_EXECS_PER_SECOND = 5;

    // debug helpers
    var debugMsg = function (prefix, msg) {
            arguments[0] = (new Date()).toTimeString() + ' - ' + arguments[0] + ': ';
            debug.debug.apply(debug, arguments);
        },

        warnMsg = function (prefix, msg) {
            arguments[0] = (new Date()).toTimeString() + ' - ' + arguments[0] + ': ';
            debug.warn.apply(debug, arguments);
        },

        errorMsg = function (prefix, msg) {
            arguments[0] = (new Date()).toTimeString() + ' - ' + arguments[0] + ': ';
            debug.error.apply(debug, arguments);
        };



    window.systemData = window.systemData || {};


    angular.module('Composer')


        // emulate a subset of the API
        .factory('System', ['$http', '$q', function ($http, $q) {
            var getSystemData = function (id) {
                var defer = $q.defer();

                if (window.systemData[id] !== undefined) {
                    defer.resolve(window.systemData[id]);
                } else {
                    // This is preferable for development
                    defer.resolve(
                        $http.get('/' + name + '.json', {headers: {
                            'Content-Type': 'application/json',
                            Accept: 'application/json'
                        }})
                    );
                }
                

                return defer.promise;
            };

            return {
                count: function (opts) {
                    return {
                        $promise: getSystemData(opts.id).then(function (resp) {
                            // Grab module count
                            if (resp[opts.module])
                                return {count: resp[opts.module].length};
                            else
                                return {count: 0};
                        })
                    };
                },

                types: function (opts) {
                    return {
                        $promise: getSystemData(opts.id).then(function (resp) {
                            // list modules
                            return Object.keys(resp);
                        })
                    };
                },

                get: function (opts, func1, func2) {
                    return {
                        $promise: getSystemData(opts.id).then(func1, func2)
                    };
                }
            }
        }])


        // ------------------------------------------------------
        // status variables
        // ------------------------------------------------------
        .factory('StatusVariableFactory', [
            '$rootScope',
            '$composer',
            function($rootScope, $composer) {
                return function(name, moduleInstance, system, connection, initVal) {
                    var statusVariable = this,
                        throttlePeriod = 0,
                        timeout = null,
                        serverVal = initVal,
                        lastSent = initVal,
                        execs = [],
                        unbindRoot;   // used to clean up the watch on root scope

                    this.val = initVal;
                    this.bindings = 0;


                    // exec functions are sent to the server to update the
                    // value of the status variable. more than one fn may
                    // be added per status variable, but this function tries
                    // to ignore duplicates. simple functions (derived from
                    // the variable name) will only be added once. non-simple
                    // functions (e.g zoom('something', 34)) will be added
                    // immediately because it's currently impossible to test
                    // whether two param functions are equivalent.
                    this.addExec = function(fn, params) {
                        if (params.simple) {
                            execs.forEach(function(exec) {
                                if (exec.fn == fn && exec.params.simple)
                                    return;
                            });
                        }

                        execs.push({
                            fn: fn,
                            params: params
                        });
                    };

                    this.setMaxExecsPerSecond = function(maxExecs) {
                        throttlePeriod = SECONDS / maxExecs;
                    };

                    // ---------------------------
                    // protocol
                    // ---------------------------
                    // binding informs the server the client wants to be informed
                    // of changes to the variable's value. connection will receive
                    // the update and 
                    this.bind = function() {
                        connection.bind(
                            system.id,
                            moduleInstance.name,
                            moduleInstance.index,
                            name
                        );
                    };

                    this.unbind = function() {
                        statusVariable.bindings -= 1;

                        if (statusVariable.bindings === 0) {
                            unbindRoot();
                            delete moduleInstance[name];
                            connection.unbind(
                                system.id,
                                moduleInstance.name,
                                moduleInstance.index,
                                name
                            );
                            if (timeout) {
                                clearTimeout(timeout);
                            }
                        }
                    };

                    this.notify = function(msg) {
                        if ($composer.debug) {
                            debugMsg('notify', msg);
                        }
                        serverVal = msg.value;
                        lastSent = serverVal;
                        statusVariable.val = serverVal;
                        $rootScope.$safeApply();
                    };

                    this.error = function(msg) {
                        if ($composer.debug) {
                            warnMsg('error', msg);
                        }
                        $rootScope.$broadcast(WARNING_BROADCAST_EVENT, msg);
                        $rootScope.$safeApply();
                    };

                    this.success = function(msg) {
                        if ($composer.debug) {
                            debugMsg('success', msg);
                        }
                    };

                    var update = function(val) {
                            // ignore updates until a connection is available
                            if (!system.id || !connection.connected)
                                return;

                            // return immediately if a timeout is waiting and will
                            // handle the new value. this.val will be updated and
                            // the timeout will send the value when it fires.
                            if (timeout)
                                return;

                            // run each exec to update the server before the
                            // throttling timer starts
                            _update();

                            // set a new timer that will fire after the throttling
                            // period. any updates made during that time will be
                            // stored in this.val. if val != this.val, an update
                            // was made during the timer period and should be sent
                            // to the server.
                            timeout = setTimeout(function() {
                                if (val != statusVariable.val)
                                    _update();
                                timeout = null;
                            }, throttlePeriod);
                        },
                        _update = function () {
                            execs.forEach(function(exec) {
                                connection.exec(
                                    system.id,
                                    moduleInstance.name,
                                    moduleInstance.index,
                                    exec.fn,
                                    exec.params()
                                );
                            });
                        };

                    // ---------------------------
                    // initialisation
                    // ---------------------------
                    // when val is updated, inform the server by running each
                    // exec. throttle execution, but ensure the final value
                    // is sent even if it occurs during the wait period.
                    unbindRoot = $rootScope.$watch(function () {
                        return statusVariable.val;
                    }, function (newval) {

                        // We compare with the last value we received from the server
                        // and the last value we requested 
                        if (newval != serverVal || newval != lastSent) {
                            lastSent = newval;
                            update(newval);
                        }
                    });

                    // the co-bind directive may override this
                    this.setMaxExecsPerSecond(DEFAULT_MAX_EXECS_PER_SECOND);

                    // once created, attempt to bind if a connection is
                    // available, and parent system is loaded
                    if (connection.connected && system.id != null)
                        this.bind();
                }
            }
        ])



        // ------------------------------------------------------
        // module instances
        // ------------------------------------------------------
        .factory('ModuleInstanceFactory', [
            'StatusVariableFactory',

            function(StatusVariable) {
                return function(name, index, varName, system, connection) {
                    var moduleInstance = this,
                        statusVariables = [];

                    this.bindings = 0;
                    this.index = index;
                    this.name = name;

                    // find or instantiate a status variable associated with
                    // this model instance. there's no check or guarantee that
                    // the created status variable will correspond with a
                    // real status variable on the server.
                    this.var = function(name, initVal) {
                        if (!moduleInstance.hasOwnProperty(name)) {
                            moduleInstance[name] = new StatusVariable(name, moduleInstance, system, connection, initVal);
                            statusVariables.push(moduleInstance[name]);
                        }
                        moduleInstance[name].bindings += 1;
                        return moduleInstance[name];
                    };

                    // on connection/reconnection every status variable is
                    // responsible for binding the new connection with the
                    // variable so notify messages can be received.
                    this.bind = function() {
                        statusVariables.forEach(function(statusVariable) {
                            statusVariable.bind();
                        });
                    };

                    this.unbind = function() {
                        moduleInstance.bindings -= 1;
                        if (moduleInstance.bindings === 0) {
                            delete system[varName];
                            statusVariables.forEach(function(statusVariable) {
                                statusVariable.unbind();
                            });
                        }
                    };
                }
            }
        ])


        // ------------------------------------------------------
        // systems
        // ------------------------------------------------------
        .factory('SystemFactory', [
            'ModuleInstanceFactory',
            '$rootScope',
            'System',
            '$composer',
            function(ModuleInstance, $rootScope, System, $composer) {
                return function(name, connection) {
                    var moduleInstances = [],
                        system = this,
                        data;

                    this.bindings = 0;
                    this.id = null;
                    this.$name = name;
                    

                    // API calls use the system id rather than system name. inform
                    // conductor of the system's id so notify msgs can be routed
                    // to this system correctly
                    System.get({id: name}, function(resp) {
                        data = resp;

                        connection.setSystemID(name, name);
                        system.id = name;
                        bind();
                    }, function(reason) {
                        if ($composer.debug)
                            warnMsg('System "' + name + '" error', reason.statusText, reason.status);
                        $rootScope.$broadcast(ERROR_BROADCAST_EVENT, 'The system "' + name + '" could not be loaded, please check your configuration.');
                    });

                    
                    var bind = function() {
                            moduleInstances.forEach(function(moduleInstance) {
                                moduleInstance.bind();
                            });
                        },
                        unbind = function() {
                            system.bindings -= 1;  // incremented in this.moduleInstance below

                            if (system.bindings === 0) {
                                delete connection[name];
                                moduleInstances.forEach(function(moduleInstance) {
                                    moduleInstance.unbind();
                                });
                            }
                        };

                    // bound status variables are stored on the system object
                    // and can be watched by elements. module_index is used
                    // to scope the variables by a module instance. each instance
                    // stores status variables, so values can be retrieved
                    // through e.g system.Display_1.power.val
                    this.moduleInstance = function(module, index) {
                        var varName = module + '_' + index;
                        if (!system.hasOwnProperty(varName)) {
                            system[varName] = new ModuleInstance(module, index, varName, system, connection);
                            moduleInstances.push(system[varName]);
                        }
                        system[varName].bindings += 1;
                        return system[varName];
                    };
                }
            }
        ])


        // ------------------------------------------------------
        // conductor - web socket
        // ------------------------------------------------------
        .service('$conductor', [
            '$rootScope',
            '$composer',
            '$timeout',
            '$safeApply',
            'SystemFactory',

            function ($rootScope, $composer, $timeout, $safeApply, System) {
                // ---------------------------
                // connection
                // ---------------------------
                this.connected = false;

                var conductor = this,
                    setConnected = function (state) {
                        if ($composer.debug) {
                            debugMsg('Mock composer connected', state);
                        }
                        conductor.connected = state;
                        $rootScope.$broadcast(CONNECTED_BROADCAST_EVENT, state);
                        $rootScope.$composerConnected = state;
                    };


                // ---------------------------
                // protocol
                // ---------------------------
                this.exec = function(system, module, index, func, args) {
                    return true;
                };

                this.bind = function(system, module, index, name) {
                    return true;
                };

                this.unbind = function(system, module, index, name) {
                    return true;
                };


                // ---------------------------
                // systems
                // ---------------------------
                var systemIDs = {};
                var systems = {};

                this.system = function(name) {
                    if (!systems[name])
                        systems[name] = new System(name, conductor);
                    systems[name].bindings += 1;
                    return systems[name];
                };

                this.removeSystem = function(name) {
                    delete systems[name];
                };

                this.setSystemID = function(name, id) {
                    systemIDs[id] = systems[name];
                };


                // Emulate a connection delay > 0
                $timeout(function () {
                    setConnected(true);
                }, 100);
            }
        ]);

}(this.angular, this.debug));
