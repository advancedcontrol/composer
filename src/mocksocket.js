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
        DEFAULT_MAX_EXECS_PER_SECOND = 20;

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
        },

        getRandomInt = function (min, max) {
            return Math.floor(Math.random() * (max - min)) + min;
        };



    window.systemData = window.systemData || {};


    angular.module('Composer')


        // Emulate obtaining the current user
        .factory('User', ['$q', '$rootScope', '$timeout', function ($q, $rootScope, $timeout) {
            var user = {};
            user.logged_in = function () {
                var defer = $q.defer();
                $timeout(function () {
                    defer.resolve('12345'); // returns our oauth token in production
                }, 50);
                return defer.promise;
            };
            user.get_current = function (force) {
                var defer = $q.defer();
                $timeout(function () {
                    var user = {
                        id: 'user-1234',
                        name: 'Steve Bob'
                    };
                    $rootScope.currentUser = user;
                    defer.resolve(user);
                }, 50);
                return defer.promise;
            }
            return user;
        }])


        // emulate a subset of the API
        .factory('System', ['$http', '$q', function ($http, $q) {
            var getSystemData = function (id) {
                var defer = $q.defer();

                if (window.systemData[id] !== undefined) {
                    defer.resolve(window.systemData[id]);
                } else {
                    // This is preferable for development
                    defer.resolve(
                        $http.get('/' + id + '.json', {headers: {
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
                        $promise: getSystemData(opts.id).then(function (resp) {
                            // Copy as we don't want to add id as a key to the object
                            resp = angular.copy(resp);
                            resp.id = opts.id;

                            func1(resp);
                        }, func2)
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
                        simpleExecs = [],
                        unbindRoot;   // used to clean up the watch on root scope

                    this.val = initVal;
                    this.$_bindings = 0;


                    // exec functions are sent to the server to update the
                    // value of the status variable. more than one fn may
                    // be added per status variable, but this function tries
                    // to ignore duplicates. simple functions (derived from
                    // the variable name) will only be added once. non-simple
                    // functions (e.g zoom('something', 34)) will be added
                    // immediately because it's currently impossible to test
                    // whether two param functions are equivalent.
                    this.addExec = function(fn, params) {
                        var result,
                            unreg = function () {
                                if (params.simple) {
                                    simpleExecs.pop();
                                } else {
                                    var index = execs.indexOf(result);
                                    if (index >= 0) {
                                        execs.splice(index, 1);
                                    }
                                }
                            };

                        result = {
                            fn: fn,
                            params: params
                        };

                        if (params.simple) {
                            simpleExecs.push(result);
                        } else {
                            execs.push(result);
                        }

                        // Unregister function
                        return unreg;
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
                            moduleInstance.$_name,
                            moduleInstance.$_index,
                            name
                        );
                    };

                    this.unbind = function() {
                        if (connection === null) return;

                        statusVariable.$_bindings -= 1;

                        if (statusVariable.$_bindings === 0) {
                            unbindRoot();
                            delete moduleInstance[name];
                            connection.unbind(
                                system.id,
                                moduleInstance.$_name,
                                moduleInstance.$_index,
                                name
                            );
                            if (timeout) {
                                clearTimeout(timeout);
                            }
                            connection = null;
                        }
                    };

                    this.notify = function(msg) {
                        if ($composer.debug) {
                            debugMsg(msg.meta.sys + ' ' + msg.meta.mod + '_' + msg.meta.index + '.' + msg.meta.name, msg.value);
                        }
                        serverVal = msg.value;
                        lastSent = serverVal;
                        statusVariable.val = serverVal;
                    };

                    this.error = function(msg) {
                        if ($composer.debug) {
                            warnMsg('error', msg);
                        }
                        $rootScope.$broadcast(WARNING_BROADCAST_EVENT, msg);
                    };

                    this.success = function(msg) {
                        if ($composer.debug) {
                            debugMsg('success ' + msg.id);
                        }
                    };

                    var _update = function (execParams) {
                            if (simpleExecs.length > 0) {
                                connection.exec(
                                    system.id,
                                    moduleInstance.$_name,
                                    moduleInstance.$_index,
                                    simpleExecs[0].fn,
                                    simpleExecs[0].params()
                                );
                            }
                            execs.forEach(function(exec) {
                                if (execParams === exec.params) {
                                    connection.exec(
                                        system.id,
                                        moduleInstance.$_name,
                                        moduleInstance.$_index,
                                        exec.fn,
                                        exec.params()
                                    );
                                }
                            });
                        };

                    this.update = function(val, execParams) {
                        // ignore updates until a connection is available
                        if (!system.id || !connection.connected)
                            return;

                        // return immediately if a timeout is waiting and will
                        // handle the new value. this.val will be updated and
                        // the timeout will send the value when it fires.
                        if (timeout)
                            return;

                        // set a new timer that will fire after the throttling
                        // period.
                        if (throttlePeriod > 0) {
                            timeout = setTimeout(function() {
                                _update(execParams);
                                timeout = null;
                            }, throttlePeriod);
                        } else {
                            _update(execParams);
                        }
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
                            statusVariable.update(newval);
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

                    this.$_bindings = 0;
                    this.$_index = index;
                    this.$_name = name;

                    // find or instantiate a status variable associated with
                    // this model instance. there's no check or guarantee that
                    // the created status variable will correspond with a
                    // real status variable on the server.
                    this.$var = function(name, initVal) {
                        if (!moduleInstance.hasOwnProperty(name)) {
                            moduleInstance[name] = new StatusVariable(name, moduleInstance, system, connection, initVal);
                            statusVariables.push(moduleInstance[name]);
                        }
                        moduleInstance[name].$_bindings += 1;
                        return moduleInstance[name];
                    };

                    // on connection/reconnection every status variable is
                    // responsible for binding the new connection with the
                    // variable so notify messages can be received.
                    this.$bind = function() {
                        statusVariables.forEach(function(statusVariable) {
                            statusVariable.bind();
                        });
                    };

                    this.$unbind = function() {
                        if (statusVariables === null) return;

                        moduleInstance.$_bindings -= 1;

                        if (moduleInstance.$_bindings === 0) {
                            delete system[varName];
                            statusVariables.forEach(function(statusVariable) {
                                statusVariable.unbind();
                            });
                            statusVariables = null;
                            moduleInstance.$var = null;
                        }
                    };
                    
                    // This provides a programmatic way to execute functions
                    this.$exec = function () {
                        var args = Array.prototype.slice.call(arguments),
                            func = args.shift();

                        connection.exec(
                            system.id,
                            moduleInstance.$_name,
                            moduleInstance.$_index,
                            func,
                            args
                        );
                    };

                    // Do we want to emulate debugging? Might be useful in the future..
                    // not implemented currently.
                    this.$debug = function (callback) {
                        return angular.noop;
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
                        unbindRoot = angular.noop,
                        data,

                        bind = function() {
                            if (!connection.connected || system.id == null)
                                return;
                            moduleInstances.forEach(function(moduleInstance) {
                                moduleInstance.$bind();
                            });
                        };

                    this.$_bindings = 0;
                    this.id = null;
                    this.$name = name;
                    this.unbind = function() {
                        if (connection === null) return;
                        
                        system.$_bindings -= 1;  // incremented in this.moduleInstance below

                        if (system.$_bindings === 0) {
                            unbindRoot();
                            connection.removeSystem(name);
                            moduleInstances.forEach(function(moduleInstance) {
                                moduleInstance.$unbind();
                            });
                            connection = null;
                            moduleInstances = null;
                            system.moduleInstance = null;
                        }
                    };
                    

                    // API calls use the system id rather than system name. inform
                    // conductor of the system's id so notify msgs can be routed
                    // to this system correctly
                    System.get({id: name}, function(resp) {
                        if (connection) {
                            system.mockdata = resp;

                            connection.setSystemID(name, name);
                            system.id = name;
                            bind();
                        } else {
                            debugMsg('System changed before id received for ', name);
                        }
                    }, function(reason) {
                        if ($composer.debug)
                            warnMsg('System "' + name + '" error', reason.statusText, reason.status);
                        $rootScope.$broadcast(ERROR_BROADCAST_EVENT, 'The system "' + name + '" could not be loaded, please check your configuration.');
                    });


                    // on disconnection, all bindings will be forgotten. rebind
                    // once connected, and after we've retrieved the system's id
                    unbindRoot = $rootScope.$on(CONNECTED_BROADCAST_EVENT, bind);


                    // bound status variables are stored on the system object
                    // and can be watched by elements. module_index is used
                    // to scope the variables by a module instance. each instance
                    // stores status variables, so values can be retrieved
                    // through e.g system.Display_1.power.val
                    this.moduleInstance = function(mod, index) {
                        var varName = mod + '_' + index;
                        if (!system.hasOwnProperty(varName)) {
                            system[varName] = new ModuleInstance(mod, index, varName, system, connection);
                            moduleInstances.push(system[varName]);
                        }
                        system[varName].$_bindings += 1;
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
            'SystemFactory',
            function ($rootScope, $composer, $timeout, System) {
                var checkingData = null;

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
                var sendRequest = function (type, system, mod, index, name, args) {
                        if (!conductor.connected)
                            return false;

                        req_id += 1;

                        var request = {
                            sys:    system,
                            mod:    mod,
                            index:  index,
                            name:   name
                        };

                        if (args !== undefined)
                            request.args = args;

                        debugMsg(type + ' request ' + req_id, request);
                        request.id = req_id;
                        request.cmd = type;

                        return request;
                    };

                this.exec = function(system, mod, index, func, args) {
                    var res = sendRequest(EXEC, system, mod, index, func, args),
                        data = systems[system].mockdata;

                    index = index - 1;

                    // Call any functions that are defined in the mock system
                    if (res && data && data[mod] && data[mod][index] && data[mod][index]['$' + func]) {
                        if (data[mod][index].$_self === undefined) {
                            // Provide access to the system
                            //  in case this is a logic module we are emulating
                            data[mod][index].$_self = data;
                        }
                        data[mod][index]['$' + func].apply(data[mod][index], args);

                        // Check the system for updates
                        // Runs through all the data and looks for anything updated
                        //  by the executing function above. It ignores special data
                        //  id and anything starting with $ (function or self)
                        if (checkingData === null) {
                            checkingData = $timeout(function () {
                                angular.forEach(systems, function(systemInst) {
                                    var mods = systemInst.mockdata;

                                    angular.forEach(mods, function(modArr, modname) {
                                        if (modname === 'id') {
                                            return;
                                        }

                                        angular.forEach(modArr, function(mod, index) {
                                            var lookup = modname + '_' + (index + 1);

                                            angular.forEach(mod, function(val, status) {
                                                if (
                                                    status.charAt(0) !== '$' &&
                                                    systemInst[lookup] &&
                                                    systemInst[lookup][status] &&
                                                    !angular.equals(systemInst[lookup][status].val, val)
                                                ) {
                                                    systemInst[lookup][status][NOTIFY]({
                                                        value: val,
                                                        type: NOTIFY,
                                                        meta: {
                                                            sys: mods.id,
                                                            mod: modname,
                                                            index: index + 1,
                                                            name: status
                                                        }
                                                    });
                                                }
                                            });
                                        });
                                    });
                                });

                                checkingData = null;
                            }, 0);
                        }
                    }

                    return res;
                };

                this.bind = function(system, mod, index, name) {
                    var res = sendRequest(BIND, system, mod, index, name),
                        sys = systems[system],
                        data = sys.mockdata,
                        lookup = mod + '_' + index;

                    index = index - 1;

                    // Set initial values
                    if (res && data && data[mod] && data[mod][index]) {
                        // Assignment occurs after this function call so wait till next tick
                        // to set the virtual server values (if they exist)
                        $timeout(function () {
                            if (name === 'connected' && !data[mod][index].hasOwnProperty(name)) {
                                data[mod][index].connected = true;
                            }

                            if (!sys[lookup][name]) {
                                console.warn("WARNING: name not found", lookup, name)
                            }

                            var moduleInstance = sys[lookup],
                                statusVariable = moduleInstance[name],
                                value = data[mod][index][name] || statusVariable.val;


                            if (value !== null && value !== undefined) {
                                statusVariable[NOTIFY]({
                                    value: value,
                                    type: NOTIFY,
                                    meta: res
                                });
                            }

                            // Emulate request time. Random number as requests
                            //  do not always come back in sequence either
                        }, getRandomInt(50, 400));
                    }

                    return res;
                };

                this.unbind = function(system, mod, index, name) {
                    return sendRequest(UNBIND, system, mod, index, name);
                };


                // ---------------------------
                // systems
                // ---------------------------
                var systemIDs = {};
                var systems = {};

                this.system = function(name) {
                    var sys = systems[name] || systemIDs[name];

                    if (!sys) {
                        sys = new System(name, conductor);
                        systems[name] = sys;
                    }

                    sys.$_bindings += 1;
                    return sys;
                };

                this.removeSystem = function(name) {
                    var sys = systems[name] || systemIDs[name];
                    if (sys) {
                        delete systems[name];
                        delete systems[sys.id];
                        delete systemIDs[name];
                        delete systemIDs[sys.id];
                    }
                };

                this.setSystemID = function(name, id) {
                    systemIDs[id] = systems[name];
                };


                // Emulate a connection delay > 0
                $timeout(function () {
                    setConnected(true);
                }, 50);
            }
        ]);

}(this.angular, this.debug));
