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

    // Cache commonly used strings
    var EXEC = 'exec',
        BIND = 'bind',
        UNBIND = 'unbind',
        DEBUG = 'debug',
        IGNORE = 'ignore',

        ARGS = [],
        FLAGS = 'memory unique stopOnFalse';

    angular.module('Composer').

        factory('$conductor', ['$composer', '$timeout', function ($composer, $timeout) {
            var state = {
                    connection: undefined,  // Websocket instance
                    connected: true,        // Are we currently connected (initialised to true so that any initial failure is triggered)
                    resume: false,          // The reference to the resume timer
                    ready: false            // are we ready to send / receive?
                },
                systems = {},   // systems we are connected to
                pending = {},   // pending requests
                dispatch = {},  // binding lookups using meta information for dispatch
                request_id = 0, // keeps track of requests

                system_logger = $.Callbacks(FLAGS),          // System events (local and remote)
                connect_callbacks = $.Callbacks(FLAGS),
                disconnect_callbacks = $.Callbacks(FLAGS),


                /// ---------- REQUEST HANDLING ---------- \\\

                build_request = function (type, system, module, index, name, args) {
                    var callbacks = $.Callbacks(FLAGS),
                        request = {
                            callbacks: callbacks,
                            data: {
                                id: request_id,
                                cmd: type,
                                sys: system,
                                mod: module,
                                index: index,
                                name: name
                            }
                        };

                    // Add args if provided
                    if (args !== undefined) {
                        request.data.args = args;
                    }

                    // Create the public interface
                    if (type === EXEC) {
                        request.pub = {
                            result: $.Callbacks(FLAGS)
                        };
                    } else {
                        request.pub = {
                            result: $.Callbacks(FLAGS),

                            // Callbacks available
                            add: callbacks.add,
                            remove: callbacks.remove,
                            fire: callbacks.fire
                        };
                    }

                    // Increment the request ID for tracking
                    request_id += 1;
                    return request;
                },

                send_request = function (request) {
                    pending[request.data.id] = request;
                    state.connection.send(
                        JSON.stringify(request.data)
                    );
                },

                meta_lookup = function (meta) {
                    return meta.sys + '_' + meta.mod + '_' + meta.index + '_' + meta.name;
                },

                dispatch_response = function (resp) {
                    var req;

                    // See websocket_manager.rb
                    // types: error, success, notify, debug
                    switch (resp.type) {
                    case 'error':
                        req = pending[resp.id];
                        delete pending[resp.id];

                        if (req) {
                            req.pub.result.fire(resp);
                            // warn about the failure
                            debug.warn((new Date()).toTimeString() + ' - request failed: ', resp, req);
                        } else {
                            // log the error (no id provided)
                            debug.warn((new Date()).toTimeString() + ' - request failure: ', resp);
                        }
                        break;
                    case 'success':
                        req = pending[resp.id];
                        delete pending[resp.id];

                        if (resp.meta) {    // bind req
                            req.pub.result.fire(resp, resp.meta);
                        } else {            // exec or debug req
                            req.pub.result.fire(resp, req.data);
                        }
                        break;
                    case 'notify':
                        dispatch[meta_lookup(resp.meta)].pub.fire(resp.value, resp.meta);
                        break;
                    case 'debug':
                        if (resp.mod === 'anonymous') {
                            system_logger.fire(resp.msg, resp);
                        } else {
                            angular.forEach(dispatch[resp.mod], function (callback) {
                                callback.fire(resp.msg, resp);
                            });
                        }
                        break;
                    }
                },

                unbind = function (type, request) {
                    request.data = request.meta;
                    delete request.meta;

                    request.data.id = request_id;
                    request.data.cmd = type;
                    if (state.ready) {
                        send_request(request);
                    }

                    // Give the request a new result callback
                    if (request.pub) {
                        request.pub.result = $.Callbacks(FLAGS);
                    }

                    // remove the dispatch information
                    if (type === UNBIND) {
                        delete dispatch[meta_lookup(request.data)];
                    } else {    // must be ignore
                        var sys = dispatch[request.data.mod] || {};
                        // meta == data (from original request)

                        delete sys[request.data.sys];
                        if ($.isEmptyObject(sys)) {
                            delete dispatch[request.data.mod];
                        }
                    }

                    request_id += 1;
                },

                add_dispatch = function (request) {
                    if (request.data.cmd === BIND) {
                        dispatch[meta_lookup(request.meta)] = request;
                    } else {    // must be a logger dispatch
                        // Multiple systems may be subscribed to it
                        var sys = dispatch[request.data.mod] || {};
                        dispatch[request.data.mod] = sys;
                        sys[request.data.sys] = request.callbacks;
                    }
                },


                /// ---------- END REQUEST HANDLING ---------- \\\


                /// ---------- SOCKET HANDLING ---------- \\\


                resume = function (token) {
                    var url = $composer.ws;
                    if (token) {
                        url += '?access_token=' + token;
                    }

                    state.connection = new WebSocket(url);
                    state.resume = $timeout(checkResume, 5000);     // check connection is valid in 5 seconds time

                    state.connection.onmessage = function (evt) {
                        var json = JSON.parse(evt.data);
                        dispatch_response(json);        // Dispatch the event
                    };

                    state.connection.onclose = function () {
                        if (state.connected) {          // We only want to trigger close the first time
                            state.connected = false;
                            state.ready = false;
                            state.connection = undefined;
                            disconnect_callbacks.fire();
                        }
                    };

                    state.connection.onopen = function () {
                        state.connected = true;         // prevent multiple disconnect triggers
                        state.ready = true;

                        // reconnect all the status
                        angular.forEach(systems, function (sys) {
                            sys.connected();
                        });

                        // inform any external listeners
                        connect_callbacks.fire();
                    };
                },


                // Requests an access token for authenticating the user for websocket use
                // We need to add it as a request params VS a header as we don't have access
                checkResume = function () {
                    if (state.connection === undefined || state.connection.readyState === state.connection.CLOSED) {
                        var token;
                        // TODO:: we need to actually rootscope emit a request
                        // for an oauth2 token
                        resume(token);
                    } else {
                        state.resume = $timeout(checkResume, 5000);     // check connection is valid
                    }
                },


                // used in system.connected
                rebind = function (request) {
                    delete request.meta;
                    // Note:: we are not over writing the result callback..
                    // Could lead to undesirable behavior? Should be documented
                    send_request(request);
                };

                /// --------- END SOCKET HANDLING -------- \\\


            // Start the connection
            checkResume();


            /// ---------- PUBLIC API ---------- \\\


            return {
                get: function (system) {
                    if (systems[system]) {
                        return systems[system];
                    }

                    var bindings = {
                            // 'sys-id_mod-id_index_status' -> request
                        },  // Bindings we have made to status variables
                        debugging = {
                            // 'sys-id_mod-id_index' -> request
                        };  // Debugging output we are receiving


                    // Add this system to list of systems we are connected to
                    systems[system] = this;

                    // Provide some signaling methods
                    this.connected = function () {
                        angular.forEach(bindings, rebind);
                        angular.forEach(debugging, rebind);
                    };

                    return {
                        exec: function (module, index, func, args) {
                            if (args === undefined) {
                                if (typeof index === 'number') {
                                    args = ARGS;   // no arguments
                                } else {
                                    args = func;
                                    func = index;
                                    index = 1;

                                    if (args === undefined) {
                                        args = ARGS;
                                    }
                                }
                            }

                            var request = build_request(EXEC, system, module, index, func, args);

                            // Fail the request if not connected.
                            if (state.ready) {
                                send_request(request);
                            } else {
                                request.defer.reject('disconnected');
                            }

                            return request.pub;
                        },
                        bind: function (module, index, status) {
                            if (typeof index !== 'number') {
                                status = index;
                                index = 1;
                            }

                            var lookup = system + '_' + module + '_' + index + '_' + status,
                                request;

                            // check if already bound
                            if (bindings[lookup]) {
                                return bindings[lookup].pub;
                            }

                            // Otherwise add the binding
                            request = build_request(BIND, system, module, index, status);
                            bindings[lookup] = request;

                            if (state.ready) {
                                send_request(request);
                            }

                            // Provide a method to unbind
                            request.pub.unbind = function () {
                                // Delete only if the same binding
                                if (request === bindings[lookup]) {
                                    delete bindings[lookup];

                                    if (request.meta !== undefined) {
                                        unbind(UNBIND, request);
                                    }
                                }
                            };

                            // Update the binding information on success
                            request.pub.result.add(function (result, meta) {
                                if (meta !== undefined) {
                                    // unbind if we were cleared during the binding process.
                                    var current = bindings[lookup];
                                    current.meta = meta;

                                    if (current === request) {
                                        add_dispatch(current);

                                    } else if (current === undefined) {
                                        // Only unbind here if nothing else has started a binding.
                                        unbind(UNBIND, request);
                                    }
                                }
                                // Else the add was a failure.
                                // We'll leave the binding for next re-connect
                            });

                            return request.pub;
                        },
                        unbind: function (module, index, status) {
                            if (typeof index !== 'number') {
                                status = index;
                                index = 1;
                            }

                            var lookup = system + '_' + module + '_' + index + '_' + status;

                            // check if already bound
                            if (bindings[lookup]) {
                                bindings[lookup].pub.unbind();
                            }
                        },


                        debug: function (module, index) {
                            if (index === undefined) {
                                index = 1;
                            }

                            var lookup = system + '_' + module,
                                request;

                            // check if already bound
                            if (debugging[lookup]) {
                                return debugging[lookup].pub;
                            }

                            // Otherwise add the debug binding
                            request = build_request(DEBUG, system, module, index, DEBUG);
                            debugging[lookup] = request;

                            if (state.ready) {
                                send_request(request);
                            }

                            // Provide a method to unbind
                            request.pub.unbind = function () {
                                // Delete only if the same binding
                                if (request === debugging[lookup]) {
                                    delete debugging[lookup];

                                    if (request.meta !== undefined) {
                                        unbind(IGNORE, request);
                                    }
                                }
                            };

                            // Update the binding information on success
                            request.pub.result.add(function (result, meta) {
                                if (meta !== undefined) {
                                    // unbind if we were cleared during the binding process.
                                    var current = debugging[lookup];
                                    current.meta = meta;

                                    if (current === request) {
                                        add_dispatch(current);

                                    } else if (current === undefined) {
                                        // unbind here as nothing else has started a binding and unbind was called.
                                        unbind(IGNORE, current);
                                    }
                                }
                            });

                            return request.pub;
                        },

                        ignore: function (module, index) {
                            if (index === undefined) {
                                index = 1;
                            }

                            var lookup = system + '_' + module;

                            // check if already bound
                            if (debugging[lookup]) {
                                debugging[lookup].pub.unbind();
                            }
                        },
                        // Clears all bindings and watches.
                        clear_bindings: function () {
                            angular.forEach(bindings, function (request) {
                                if (request.meta !== undefined) {
                                    unbind(UNBIND, request);
                                }
                            });
                            bindings = {};
                        },
                        clear_debug: function () {
                            angular.forEach(debugging, function (request) {
                                if (request.meta !== undefined) {
                                    unbind(UNBIND, debugging);
                                }
                            });
                            debugging = {};
                        },
                        dump_state: function () {
                            debug.debug((new Date()).toTimeString() + ' - Dumping state...');
                            debug.debug("-- System '" + system + "' State --");
                            debug.debug('bindings: ', bindings);
                            debug.debug('debugging: ', debugging);
                            debug.debug('-- Global State --');
                            debug.debug('systems requested: ', systems);
                            debug.debug('pending requests: ', pending);
                            debug.debug('dispatch list: ', dispatch);
                        }
                    };
                },
                on_connect: connect_callbacks,
                on_disconnect: disconnect_callbacks,
                logger: system_logger,
                dump_state: function () {
                    debug.debug((new Date()).toTimeString() + ' - Dumping state...');
                    debug.debug('-- Global State --');
                    debug.debug('systems requested: ', systems);
                    debug.debug('pending requests: ', pending);
                    debug.debug('dispatch list: ', dispatch);
                }
            };
        }]);

}(this.WebSocket || this.MozWebSocket, this.jQuery, this.angular, this.debug));
