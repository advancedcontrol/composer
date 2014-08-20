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
    var CONNECTED_BROADCAST_EVENT = '$conductor:connected',
        MAX_EXECS_PER_SECOND = 10;

    // debug helpers
    function debugMsg(prefix, msg) {
        debug.debug((new Date()).toTimeString() + ' - ' + prefix + ': ', msg);
    }

    function warnMsg(prefix, msg) {
        debug.warn((new Date()).toTimeString() + ' - ' + prefix + ': ', msg);
    }


    angular.module('Composer')

        .factory('StatusVariableFactory', [
            '$rootScope',
            function($rootScope) {
                return function(name, moduleInstance, system, connection) {
                    var statusVariable = this;
                    var observers = [];
                    var execs = [];
                    this.val = null;

                    // ---------------------------
                    // setup
                    // ---------------------------
                    // observers are objects (co-bind directive instances) which
                    // receive success and failure notifications
                    this.addObserver = function(observer) {
                        observers.push(observer);
                    }

                    // exec functions are sent to the server to update the
                    // value of the status variable
                    this.addExec = function(fn, params) {
                        execs.push({
                            fn: fn,
                            params: params
                        });
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

                    this.notify = function(msg) {
                        statusVariable.val = msg.value;
                        $rootScope.$safeApply();
                    }

                    this.error = function(msg) {
                        observers.forEach(function(observer) {
                            if (observer.statusVariableError)
                                observer.statusVariableError(statusVariable, msg);
                        });
                    }

                    this.success = function(msg) {
                        observers.forEach(function(observer) {
                            if (observer.statusVariableSuccess)
                                observer.statusVariableSuccess(statusVariable, msg);
                        });
                    }

                    // when val is updated, inform the server by running each
                    // exec. throttle execution, but ensure the final value
                    // is sent even if it occurs during the wait period.
                    $rootScope.$watch(function() {
                        return statusVariable.val;
                    }, function(newval, oldval) {
                        // TODO: should we queue execs until system.id != null && connected?
                        if (!system.id || newval == oldval)
                            return;

                        execs.forEach(function(exec) {
                            connection.exec(
                                system.id,
                                moduleInstance.name,
                                moduleInstance.index,
                                exec.fn,
                                exec.params()
                            );
                        });
                    });

                    // once created, attempt to bind if a connection is
                    // available, and parent system is loaded
                    if (connection.connected && system.id != null)
                        this.bind();
                }
            }
        ])

        .factory('ModuleInstanceFactory', [
            'StatusVariableFactory',
            function(StatusVariable) {
                return function(name, index, system, connection) {
                    var moduleInstance = this;
                    var statusVariables = [];
                    this.index = index;
                    this.name = name;

                    this.var = function(name) {
                        if (!moduleInstance.hasOwnProperty(name)) {
                            moduleInstance[name] = new StatusVariable(name, moduleInstance, system, connection);
                            statusVariables.push(moduleInstance[name]);
                        }
                        return moduleInstance[name];
                    }

                    this.bind = function() {
                        statusVariables.forEach(function(statusVariable) {
                            statusVariable.bind();
                        });
                    }
                }
            }
        ])

        .factory('SystemFactory', [
            'ModuleInstanceFactory',
            '$rootScope',
            'System',
            function(ModuleInstance, $rootScope, System) {
                return function(systemName, connection) {
                    var moduleInstances = [];
                    var system = this;
                    this.id = null;

                    // API calls use the system ID rather than system name. inform
                    // conductor of the system's id so notify msgs can be routed
                    // to this system correctly
                    System.get({id: systemName}, function(resp) {
                        connection.setSystemID(systemName, resp.id);
                        system.id = resp.id;
                        bind();
                    }, function(reason) {
                    });

                    // on disconnection, all bindings will be forgotten. rebind
                    // once connected, and after we've retrieved the system's id
                    $rootScope.$on(CONNECTED_BROADCAST_EVENT, bind);

                    function bind() {
                        if (connection.connected && system.id != null) {
                            moduleInstances.forEach(function(moduleInstance) {
                                moduleInstance.bind();
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
                            system[varName] = new ModuleInstance(module, index, system, connection);
                            moduleInstances.push(system[varName]);
                        }
                        return system[varName];
                    }
                }
            }
        ])

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
                // can be watched. its state is also broadcast through rootScope.
                // systems watch the connected state, and add their bindings
                // when a connection becomes available. connections are pinged
                // every n seconds to keep them alive.
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

                    var request = {
                        id:     0,
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

                this.system = function(systemName) {
                    if (!systems[systemName])
                        systems[systemName] = new System(systemName, conductor);
                    return systems[systemName];
                }

                this.removeSystem = function(systemName) {
                    delete systems[systemName];
                }

                this.setSystemID = function(systemName, id) {
                    systemIDs[id] = systems[systemName];
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
