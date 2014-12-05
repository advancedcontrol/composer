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


(function (WebSocket, angular, debug) {
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
        };


    angular.module('Composer')

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

                    this.unbind = function(force) {
                        if (connection === null) return;

                        statusVariable.$_bindings -= 1;    // incremented in ModuleInstanceFactory.$var below

                        if (force || statusVariable.$_bindings <= 0) {
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


                    var _update = function () {
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
                                connection.exec(
                                    system.id,
                                    moduleInstance.$_name,
                                    moduleInstance.$_index,
                                    exec.fn,
                                    exec.params()
                                );
                            });
                        };

                    this.update = function(val) {
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
                                _update();
                                timeout = null;
                            }, throttlePeriod);
                        } else {
                            _update();
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

                    this.$unbind = function(force) {
                        if (statusVariables === null) return;

                        moduleInstance.$_bindings -= 1;  // incremented in SystemFactory.moduleInstance below

                        if (force || moduleInstance.$_bindings <= 0) {
                            delete system[varName];
                            statusVariables.forEach(function(statusVariable) {
                                statusVariable.unbind('force');
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
            '$timeout',
            function(ModuleInstance, $rootScope, System, $composer, $timeout) {
                return function(name, connection) {
                    var moduleInstances = [],
                        system = this,
                        unbindRoot = angular.noop,
                        bind = function() {
                            if (!connection.connected || system.id == null)
                                return;
                            moduleInstances.forEach(function(moduleInstance) {
                                moduleInstance.$bind();
                            });
                        },

                        retryTimer,
                        getSystemID = function () {
                            // API calls use the system id rather than system name. inform
                            // conductor of the system's id so notify msgs can be routed
                            // to this system correctly
                            retryTimer = null;
                            System.get({id: name}, function(resp) {
                                connection.setSystemID(name, resp.id);
                                system.id = resp.id;
                                bind();
                            }, function(reason) {
                                if ($composer.debug)
                                    warnMsg('System "' + name + '" error', reason.statusText, reason.status);
                                $rootScope.$broadcast(ERROR_BROADCAST_EVENT, 'The system "' + name + '" could not be loaded, please check your configuration.');

                                retryTimer = $timeout(getSystemID, 3500);
                            });
                        };

                    this.$_bindings = 0;
                    this.id = null;
                    this.$name = name;
                    this.unbind = function() {
                        if (retryTimer) $timeout.cancel(retryTimer);
                        if (connection === null) return;
                        
                        system.$_bindings -= 1;  // incremented in $conductor.system below

                        if (system.$_bindings <= 0) {
                            unbindRoot();
                            connection.removeSystem(name);
                            moduleInstances.forEach(function(moduleInstance) {
                                moduleInstance.$unbind('force');
                            });
                            connection = null;
                            moduleInstances = null;
                            system.moduleInstance = null;
                        }
                    };
                    
                    // We want this to retry if it initially fails
                    getSystemID();

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
            '$safeApply',
            'SystemFactory',
            '$comms',

            function ($rootScope, $composer, $timeout, $safeApply, System, $comms) {
                // ---------------------------
                // connection
                // ---------------------------
                // web socket connection - connected is a public variable that
                // can be queried. its state is broadcast through rootScope.
                // systems watch for the broadcast, and add their bindings when
                // a connection becomes available. connections are pinged every
                // n seconds to keep them alive.
                this.connected = false;

                var keepAliveInterval = null,
                    connection = null,
                    conductor = this,

                    connect = function() {
                        // Connect to the websocket with an access token
                        if ($composer.service) {
                            $comms.getToken($composer.service)
                            .then(function (token) {
                                connection = new WebSocket($composer.ws + '?bearer_token=' + token);
                                connection.onmessage = onmessage;
                                connection.onclose = onclose;
                                connection.onopen = onopen;
                            });
                        } else {
                            connection = new WebSocket($composer.ws);
                            connection.onmessage = onmessage;
                            connection.onclose = onclose;
                            connection.onopen = onopen;
                        }
                    },

                    reconnect = function () {
                        if (connection == null || connection.readyState === connection.CLOSED)
                            connect();
                    },

                    startKeepAlive = function () {
                        keepAliveInterval = window.setInterval(function() {
                            connection.send(PING);
                        }, KEEP_ALIVE_TIMER_SECONDS);
                    },

                    stopKeepAlive = function () {
                        window.clearInterval(keepAliveInterval);
                    },

                    setConnected = function (state) {
                        if ($composer.debug) {
                            debugMsg('Composer connected', state);
                        }
                        conductor.connected = state;
                        $rootScope.$safeApply(function () {
                            $rootScope.$broadcast(CONNECTED_BROADCAST_EVENT, state);
                            $rootScope.$composerConnected = state;
                        });
                    };


                // ---------------------------
                // event handlers
                // ---------------------------
                var onopen = function (evt) {
                        setConnected(true);
                        startKeepAlive();
                    },

                    onclose = function (evt) {
                        if (!conductor.connected)
                            return;
                        setConnected(false);
                        connection = null;
                        stopKeepAlive();
                    },

                    onmessage = function (evt) {
                        // message data will either be the string 'PONG', or json
                        // data with an associated type
                        if (evt.data == PONG) {
                            return;
                        }
                        else {
                            var msg = JSON.parse(evt.data);
                        }

                        // success, error and notify messages are all handled by
                        // status variable instances. if meta is available (defining
                        // the system id, module name, index and variable name)
                        // attempt to retrieve a reference to the status variable
                        // specified, before passing responsibility for handling the
                        // message to it. if retrieval fails at any step (e.g because
                        // no module instance matches the path specified by meta)
                        // log debug information as the fail action.
                        if (msg.type == SUCCESS || msg.type == ERROR || msg.type == NOTIFY) {
                            var meta = msg.meta;
                            if (!meta) {
                                if ($composer.debug) {
                                    if (msg.type == SUCCESS) {
                                        // NOTE:: exec requests don't pass back meta information
                                        debugMsg(msg.type, msg);
                                    } else {
                                        warnMsg(msg.type, msg);
                                    }
                                }

                                return;
                            }

                            var system = systemIDs[meta.sys];
                            if (!system) {
                                if ($composer.debug)
                                    warnMsg(msg.type + ' received for unknown system', msg);

                                return;
                            }

                            var moduleInstance = system[meta.mod + '_' + meta.index];
                            if (!moduleInstance) {
                                if ($composer.debug)
                                    warnMsg(msg.type + ' received for unknown module instance', msg);

                                return;
                            }
                            
                            var statusVariable = moduleInstance[meta.name];
                            if (!statusVariable) {
                                if ($composer.debug)
                                    warnMsg(msg.type + ' received for unknown status variable', msg);

                                return;
                            }

                            statusVariable[msg.type](msg);

                        } else if ($composer.debug) {
                            warnMsg('Unknown message "' + msg.type + '"" received', msg);
                        }
                    };


                // ---------------------------
                // protocol
                // ---------------------------
                var sendRequest = function (type, system, mod, index, name, args) {
                        if (!conductor.connected)
                            return false;

                        req_id += 1;

                        var request = {
                            id:     req_id,
                            cmd:    type,
                            sys:    system,
                            mod:    mod,
                            index:  index,
                            name:   name
                        };

                        if (args !== undefined)
                            request.args = args;

                        connection.send(
                            JSON.stringify(request)
                        );

                        if ($composer.debug) {
                            debugMsg(type + ' request', request);
                        }

                        return true;
                    };

                this.exec = function(system, mod, index, func, args) {
                    return sendRequest(EXEC, system, mod, index, func, args);
                };

                this.bind = function(system, mod, index, name) {
                    return sendRequest(BIND, system, mod, index, name);
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


                // ---------------------------
                // initialisation
                // ---------------------------
                // start a connection, and monitor the connection every n
                // seconds, reconnecting if needed
                window.setInterval(reconnect, RECONNECT_TIMER_SECONDS);
                connect();
            }
        ]);

}(this.WebSocket || this.MozWebSocket, this.angular, this.debug));
