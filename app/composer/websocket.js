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


(function (WebSocket, $, angular, debug) {
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
        DEFAULT_MAX_EXECS_PER_SECOND = 5;

    // debug helpers
    function debugMsg(prefix, msg) {
        debug.debug((new Date()).toTimeString() + ' - ' + prefix + ': ', msg);
    }

    function warnMsg(prefix, msg) {
        debug.warn((new Date()).toTimeString() + ' - ' + prefix + ': ', msg);
    }



    angular.module('Composer')

        // ------------------------------------------------------
        // status variables
        // ------------------------------------------------------
        .factory('StatusVariableFactory', [
            '$rootScope',

            function($rootScope) {
                return function(name, moduleInstance, system, connection, initVal) {
                    var statusVariable = this,
                        successObservers = [],
                        errorObservers = [],
                        throttlePeriod = 0,
                        timeout = null,
                        serverVal = initVal,
                        execs = [],
                        unbindRoot;   // used to clean up the watch on root scope

                    this.val = initVal;
                    this.bindings = 0;

                    // ---------------------------
                    // setup
                    // ---------------------------
                    // observers are objects (co-bind directive instances) which
                    // receive success and error notifications
                    this.addObserver = function(successFn, errorFn) {
                        successObservers.push(successFn);
                        errorObservers.push(errorFn);
                    }

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
                    }

                    this.setMaxExecsPerSecond = function(maxExecs) {
                        throttlePeriod = SECONDS / maxExecs;
                    }

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
                    }

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
                    }

                    this.notify = function(msg) {
                        serverVal = msg.value;
                        statusVariable.val = serverVal;
                        $rootScope.$safeApply();
                    }

                    this.error = function(msg) {
                        warnMsg('error', msg);
                        errorObservers.forEach(function(fn) {
                            fn(statusVariable, msg);
                        });
                    }

                    this.success = function(msg) {
                        successObservers.forEach(function(fn) {
                            fn(statusVariable, msg);
                        });
                    }

                    function update(val) {
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
                    }

                    function _update() {
                        execs.forEach(function(exec) {
                            connection.exec(
                                system.id,
                                moduleInstance.name,
                                moduleInstance.index,
                                exec.fn,
                                exec.params()
                            );
                        });
                    }

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
                        if (newval != serverVal)
                            update(newval);
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
                    var moduleInstance = this;
                    var statusVariables = [];
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
                    }

                    // on connection/reconnection every status variable is
                    // responsible for binding the new connection with the
                    // variable so notify messages can be received.
                    this.bind = function() {
                        statusVariables.forEach(function(statusVariable) {
                            statusVariable.bind();
                        });
                    }

                    this.unbind = function() {
                        moduleInstance.bindings -= 1;
                        if (moduleInstance.bindings === 0) {
                            delete system[varName];
                            statusVariables.forEach(function(statusVariable) {
                                statusVariable.unbind();
                            });
                        }
                    }
                }
            }
        ])


        // ------------------------------------------------------
        // systems
        // ------------------------------------------------------
        .factory('SystemFactory', [
            'ModuleInstanceFactory',
            'growlNotifications',
            '$rootScope',
            'System',

            function(ModuleInstance, growlNotifications, $rootScope, System) {
                return function(name, connection) {
                    var moduleInstances = [],
                        system = this,
                        unbindRoot;

                    this.bindings = 0;
                    this.id = null;
                    this.$name = name;
                    

                    // API calls use the system id rather than system name. inform
                    // conductor of the system's id so notify msgs can be routed
                    // to this system correctly
                    System.get({id: name}, function(resp) {
                        connection.setSystemID(name, resp.id);
                        system.id = resp.id;
                        bind();
                    }, function(reason) {
                        growlNotifications.add(
                            'The system "' + name + '" could not be loaded, and may be misspelt.',
                            'error'
                        );
                    });

                    // on disconnection, all bindings will be forgotten. rebind
                    // once connected, and after we've retrieved the system's id
                    unbindRoot = $rootScope.$on(CONNECTED_BROADCAST_EVENT, bind);

                    function bind() {
                        if (!connection.connected || system.id == null)
                            return;
                        moduleInstances.forEach(function(moduleInstance) {
                            moduleInstance.bind();
                        });
                    }

                    function unbind() {
                        system.bindings -= 1;
                        if (system.bindings === 0) {
                            unbindRoot();
                            delete connection[name];
                            moduleInstances.forEach(function(moduleInstance) {
                                moduleInstance.unbind();
                            });
                        }
                    }

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
                    }
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
                // web socket connection - connected is a public variable that
                // can be queried. its state is broadcast through rootScope.
                // systems watch for the broadcast, and add their bindings when
                // a connection becomes available. connections are pinged every
                // n seconds to keep them alive.
                var keepAliveInterval = null;
                this.connected = false;
                var connection = null;
                var conductor = this;

                function connect() {
                    connection = new WebSocket($composer.ws);
                    connection.onmessage = onmessage;
                    connection.onclose = onclose;
                    connection.onopen = onopen;
                }

                function reconnect() {
                    if (connection == null || connection.readyState === connection.CLOSED)
                        connect();
                }

                function startKeepAlive() {
                    keepAliveInterval = window.setInterval(function() {
                        connection.send(PING);
                    }, KEEP_ALIVE_TIMER_SECONDS);
                }

                function stopKeepAlive() {
                    window.clearInterval(keepAliveInterval);
                }

                function setConnected(state) {
                    conductor.connected = state;
                    $rootScope.$broadcast(CONNECTED_BROADCAST_EVENT, state);
                }


                // ---------------------------
                // event handlers
                // ---------------------------
                function onopen(evt) {
                    setConnected(true);
                    startKeepAlive();
                }

                function onclose(evt) {
                    if (!conductor.connected)
                        return;
                    setConnected(false);
                    connection = null;
                    stopKeepAlive();
                }

                function onmessage(evt) {
                    // message data will either be the string 'PONG', or json
                    // data with an associated type
                    if (evt.data == PONG)
                        return;
                    else
                        var msg = JSON.parse(evt.data);

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
                        if (!meta)
                            return debugMsg('request - ' + msg.type, msg);

                        var system = systemIDs[meta.sys];
                        if (!system)
                            return debugMsg(msg.type + ' received for unknown system', msg);

                        var moduleInstance = system[meta.mod + '_' + meta.index];
                        if (!moduleInstance)
                            return debugMsg(msg.type + ' received for unknown module instance', msg);
                        
                        var statusVariable = moduleInstance[meta.name];
                        if (!statusVariable)
                            return debugMsg(msg.type + ' received for unknown status variable', msg);

                        statusVariable[msg.type](msg);

                    } else {
                        if (msg.mod === 'anonymous') {
                            //system_logger.fire(msg.msg, msg);
                        } else {
                            /*angular.forEach(debuggers[msg.mod], function (callback) {
                                callback.fire(msg.msg, msg);
                            });*/
                        }

                    }
                }


                // ---------------------------
                // protocol
                // ---------------------------
                function sendRequest(type, system, module, index, name, args) {
                    if (!conductor.connected)
                        return false;

                    req_id += 1;

                    var request = {
                        id:     req_id,
                        cmd:    type,
                        sys:    system,
                        mod:    module,
                        index:  index,
                        name:   name
                    };

                    if (args !== undefined)
                        request.args = args;

                    connection.send(
                        JSON.stringify(request)
                    );

                    return true;
                }

                this.exec = function(system, module, index, func, args) {
                    return sendRequest(EXEC, system, module, index, func, args);
                }

                this.bind = function(system, module, index, name) {
                    return sendRequest(BIND, system, module, index, name);
                }

                this.unbind = function(system, module, index, name) {
                    return sendRequest(UNBIND, system, module, index, name);
                }


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
                }

                this.removeSystem = function(name) {
                    delete systems[name];
                }

                this.setSystemID = function(name, id) {
                    systemIDs[id] = systems[name];
                }


                // ---------------------------
                // initialisation
                // ---------------------------
                // start a connection, and monitor the connection every n
                // seconds, reconnecting if needed
                window.setInterval(reconnect, RECONNECT_TIMER_SECONDS);
                connect();
            }
        ]);

}(this.WebSocket || this.MozWebSocket, this.jQuery, this.angular, this.debug));
