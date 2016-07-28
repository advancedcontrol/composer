(function (angular, window, debug) {
    'use strict';
    
    // Splits up a module name defained as "ModName_1"
    // Into {module: 'ModName', index: 1}
    window.getModuleParts = function (key) {
        var parts = key.split('_'),
            index = parseInt(parts[parts.length - 1], 10),
            module;

        parts.splice(parts.length - 1, 1);
        module = parts.join('_');

        return {
            module: module,
            index: index
        };
    };

    var FUNCTION_RE = /(\w+)\((.+)\)/,
        PARAM_RE = /[\S][^,\s][^,]*/g,
        COUNT_RE = /^\s*([\s\S]+?)\s+as\s+([\s\S]+?)\s*$/,

        // TODO:: duplicate variable in websocket. Should DRY this up.
        ERROR_BROADCAST_EVENT = '$conductor:error',

        // Ref: https://developer.mozilla.org/en/docs/Web/JavaScript/Reference/Global_Objects/Object/defineProperty
        WITH_VAL = function (value) {
            return {
                configurable: true,
                enumerable: true,
                value: value,
                writable: true
            };
        },

        findAndWatch = function ($scope, binding, callback, actual) {
            var found = false,
                parentcount = 0,
                scope = $scope,
                actual = actual || binding;

            // search for the value through parent scopes
            do {
                if (scope[actual] !== undefined) {
                    found = true;
                } else {
                    parentcount += 1;
                    scope = scope.$parent;
                }
            } while (!found && scope);

            // if not found we fall through to watch on the local scope
            while (found && parentcount > 0) {
                binding = '$parent.' + binding;
                parentcount -= 1;
            }

            if (binding === actual) {
                $scope.$watch(binding, callback);
            } else {
                $scope.$watch(binding, function (value) {
                    callback($scope[actual]);
                });
            }
        };

    angular.module('Composer')

        // Rest API based directives
        .directive('indicesOf', [
            'System', 
            '$rootScope',
            '$parse',
        function(System, $rootScope, $parse) {
            return {
                restrict: 'A',
                link: function ($scope, element, attrs) {
                    var expression = attrs.indicesOf,
                        match = expression.match(COUNT_RE);

                    if (!match) {
                        throw 'Expected in the form of indices-of="moduleType as scopeVar" but got indices-of="' + expression + '"';
                    }

                    var modRaw = match[1],
                        scopeVar = match[2],
                        varSetter = $parse(scopeVar).assign;

                    findAndWatch($scope, 'coSystem.id', function (system) {
                        if (system && system.id) {
                            var setCount = function (data) {

                                    // Create an array of indices so we can iterate over them
                                    //  using an ng-repeat for setting module index values
                                    var i,
                                        indices = [];
                                    for (i = 0; i < data.count; i += 1) {
                                        indices.push(i + 1);
                                    }

                                    // On success update the list data
                                    system.$countOf[moduleType] = indices;
                                    varSetter($scope, indices);
                                },
                                loadFailed = function (failed) {
                                    $rootScope.$broadcast(ERROR_BROADCAST_EVENT, 'Error loading the number of "' + moduleType + '" in system "' + system.$name + '".');
                                    varSetter($scope, []);  // Invalidate any existing data
                                },
                                moduleType = $scope.$eval(modRaw);

                            system.$countOf = system.$countOf || {};

                            // Check if cached - avoid hitting the API if we don't need to
                            if (system.$countOf[moduleType]) {

                                // Use the cached value
                                if (system.$countOf[moduleType].hasOwnProperty('then')) {
                                    system.$countOf[moduleType].then(setCount, loadFailed);
                                } else {
                                    varSetter($scope, system.$countOf[moduleType]);
                                }
                            } else {

                                // API Request
                                system.$countOf[moduleType] = System.count({
                                    id: system.$name,
                                    module: moduleType
                                }).$promise;
                                system.$countOf[moduleType].then(setCount, loadFailed);
                            }
                        } else {
                            varSetter($scope, []);
                        }
                    }, 'coSystem');
                }
            };
        }])

        .directive('moduleList', [
            'System',
            '$rootScope',
            '$parse',
        function(System, $rootScope, $parse) {
            return {
                restrict: 'A',
                link: function ($scope, element, attrs) {
                    findAndWatch($scope, 'coSystem.id', function (system) {
                        if (system && system.id) {
                            var scopeVar = attrs.moduleList || 'moduleList',
                                varSetter = $parse(scopeVar).assign,
                                setModuleList = function (modList) {
                                    system.$moduleList = modList;
                                    varSetter($scope, modList);
                                },
                                loadFailed = function () {
                                    $rootScope.$broadcast(ERROR_BROADCAST_EVENT, 'Error loading the list of modules in system "' + $scope.coSystem.$name + '".');
                                    varSetter($scope, []);  // Invalidate any existing data
                                };

                            // Check if cached - avoid hitting the API if we don't need to
                            if (system.$moduleList) {

                                // Use the cached value
                                if (system.$moduleList.hasOwnProperty('then')) {
                                    system.$moduleList.then(setModuleList, loadFailed);
                                } else {
                                    varSetter($scope, $scope.coSystem.$moduleList);
                                }
                            } else {

                                // API Request
                                system.$moduleList = System.types({id: system.$name}).$promise;
                                system.$moduleList.then(setModuleList, loadFailed);
                            }
                        } else {
                            varSetter($scope, []);
                        }
                    }, 'coSystem');
                }
            };
        }])


        // -----------------------------
        // scopes
        // -----------------------------
        .directive('coSystem', [
            '$conductor',
        function($conductor) {
            var unbind = function($scope) {
                if ($scope.hasOwnProperty('coSystem')) {
                    $scope.coSystem.unbind();
                }
            };

            return {
                restrict: 'A',
                scope: true,
                link: function($scope, element, attrs) {
                    $scope.$watch(attrs.coSystem, function (system) {
                        if (system) {
                            unbind($scope);
                            Object.defineProperty($scope, 'coSystem', WITH_VAL($conductor.system(system)));
                        }
                    });
                    
                    $scope.$on('$destroy', function () {
                        unbind($scope);
                    });
                }
            };
        }])

        .directive('coModule', function() {
            return {
                restrict: 'A',
                scope: true,
                link: function($scope, element, attrs) {
                    Object.defineProperty($scope, 'coModule', WITH_VAL(null));

                    // store the string name and integer index of a module instance
                    // index may be overwritten by a co-index directive
                    $scope.$watch(attrs.coModule, function (value) {
                        if (value) {
                            if (attrs.hasOwnProperty('coImplicitIndex')) {
                                var parts = window.getModuleParts(value);
                                Object.defineProperty($scope, 'coModule', WITH_VAL(parts.module));
                                Object.defineProperty($scope, 'coIndex', WITH_VAL(parts.index));
                            } else {
                                Object.defineProperty($scope, 'coModule', WITH_VAL(value));
                            }
                        }
                    });

                    if (attrs.index) {
                        $scope.$watch(attrs.index, function (value) {
                            if (value) {
                                Object.defineProperty($scope, 'coIndex', WITH_VAL(value));
                            }
                        });
                    } else {
                        Object.defineProperty($scope, 'coIndex', WITH_VAL(1));
                    }
                }
            };
        })

        .directive('coIndex', function() {
            return {
                restrict: 'A',
                scope: true,
                link: function($scope, element, attrs) {
                    Object.defineProperty($scope, 'coIndex', WITH_VAL(null));
                    $scope.$watch(attrs.coIndex, function (value) {
                        if (value) {
                            Object.defineProperty($scope, 'coIndex', WITH_VAL(value));
                        }
                    });
                }
            };
        })


        // Provides debugging output for the in-scope module
        .directive('coDebug', function() {
            return {
                restrict: 'A',
                scope: false,   // No new scope required
                link: function($scope, element, attrs) {
                    var mod,
                        unregister,
                        defaultCallback = function (message) {
                            debug[message.level]($scope.coSystem.$name + ' -> ' + 
                                $scope.coModule + '_' + $scope.coIndex + ': ' + 
                                message.msg, message.klass, message.mod);
                        },
                        callback = $scope.$eval(attrs.coDebug) || defaultCallback,
                        stopDebugging = function () {
                            if (mod) {
                                unregister();
                                unregister = null;
                                mod = null;
                            }
                        };

                    $scope.$watch('coModuleInstance', function (newMod, oldMod) {
                        stopDebugging();

                        if (newMod) {
                            mod = newMod;
                            unregister = mod.$debug(function (message) {
                                callback(message);
                            });
                        }
                    });

                    $scope.$watch(attrs.coDebug, function (value) {
                        callback = value || defaultCallback;
                    });

                    $scope.$on('$destroy', stopDebugging);
                }
            };
        })


        // -----------------------------
        // widgets
        // -----------------------------
        .directive('coBind', [
            '$timeout',
            '$parse',
        function($timeout, $parse) {
            return {
                restrict: 'A',
                scope: false,
                link: function ($scope, element, attrs) {
                    var coSystem,
                        coModule,
                        coIndex,

                        // These are the new state
                        coBind,
                        localVar,

                        // These are the existing state
                        boundTo,
                        boundCounter,
                        boundMod,
                        oldLocal,
                        oldLocalSetter,
                        oldLocalGetter,
                        varWatch,
                        localWatch,
                        execUnreg,
                        performUnbind = function () {
                            if (boundTo) {
                                // stop watching
                                varWatch();
                                localWatch();
                                if (execUnreg) {
                                    execUnreg();
                                }
                                varWatch = null;
                                localWatch = null;
                                execUnreg = null;

                                delete $scope.coModuleInstance;
                                delete $scope[oldLocal];
                                oldLocal = null;
                                oldLocalGetter = null;
                                oldLocalSetter = null;

                                $scope[boundCounter] -= 1;

                                // Don't clean up variables if shared
                                if ($scope[boundCounter] === 0) {
                                    $scope[boundTo].unbind();
                                    delete $scope[boundTo];
                                    delete $scope[boundCounter];
                                }

                                boundCounter = null;
                                boundTo = null;
                            }
                        },

                        // Status binding
                        pendingCheck,
                        escapeVar = function (str) {
                            return str.replace(/( |-|\.)/g, '$_');
                        },
                        checkCanBind = function () {
                            performUnbind();

                            if (!pendingCheck && coSystem && coModule && coIndex && coBind) {

                                // Timeout as both coModule and coIndex may have changed
                                // we want to wait till the end of the apply cycle
                                pendingCheck = $timeout(function () {
                                    pendingCheck = null;
                                    if (coSystem && coModule && coIndex && coBind) {
                                        boundTo = '$stat_' + escapeVar(coBind);
                                        boundCounter = boundTo + '_bindings';

                                        // Ensure unbinding is required
                                        if (boundMod && boundMod !== coModule) {
                                            if ($scope.coModuleInstance && $scope.coModuleInstance.name !== coModule) {
                                                $scope.coModuleInstance.$unbind();
                                                delete $scope.coModuleInstance;
                                            }
                                        }

                                        boundMod = coModule;
                                        oldLocal = localVar;
                                        oldLocalGetter = $parse(localVar);
                                        oldLocalSetter = oldLocalGetter.assign;
                                        if (!oldLocalSetter) {
                                            throw 'Invalid binding. Expected in the form of bind="expression as var_name" but got bind="' + coBind + ' as ' + localVar + '"';
                                        }
                                        performBinding();
                                    }
                                }, 0); // we don't want to trigger another apply
                            }
                        },
                        performBinding = function () {
                            
                            // coIndex defaults to 1 in co-module, and means co-index isn't
                            // a required directive. to avoid instantiating module instances
                            // with index 1 when they're not needed (or are invalid), defer
                            // instantiation to bindings (when we know the final index value)

                            if (!$scope.hasOwnProperty('coModuleInstance')) {
                                Object.defineProperty($scope, 'coModuleInstance', WITH_VAL(
                                    coSystem.moduleInstance(
                                        coModule,
                                        coIndex
                                    )
                                ));
                            }

                            // Set the initial value if any
                            var initVal = null;

                            if (attrs.hasOwnProperty('initVal')) {
                                initVal = $scope.$eval(attrs.initVal);
                            }

                            // instantiate or get a reference to the status variable
                            if (!$scope.hasOwnProperty(boundTo)) {
                                Object.defineProperty($scope, boundTo, WITH_VAL(
                                    $scope.coModuleInstance.$var(coBind, initVal)
                                ));
                                Object.defineProperty($scope, boundCounter, WITH_VAL(1));
                            } else {
                                $scope[boundCounter] += 1;
                            }

                            // Make the value available to the local variable
                            var serverVal,
                                lastLocal;

                            varWatch = $scope.$watch(boundTo + '.val', function (value) {
                                serverVal = value;
                                lastLocal = value;

                                oldLocalSetter($scope, value);
                            });

                            localWatch = $scope.$watch(oldLocal, function (newval) {
                                if (newval != serverVal || newval != lastLocal) {
                                    lastLocal = newval;
                                    $scope[boundTo].update(newval, execParams);
                                }
                            });

                            // override default exec throttling if provided
                            if (attrs.hasOwnProperty('maxEps'))
                                $scope[boundTo].setMaxExecsPerSecond(attrs.maxEps);

                            // execFn and execParams are used to inform the server of updates
                            // to the status variable being bound. updates are either ignored,
                            // updated using a function derived from the variable name, or
                            // updated using a user specified exec function and params
                            if (!attrs.hasOwnProperty('exec')) {
                                // read only bindings have no exec attribute
                                var execFn = null;
                                var execParams = null;
            
                            } else if (attrs.exec == '') {
                                // when the bound status variable is the same name as the
                                // remote function, and only takes a single param, we can
                                // construct the exec call from the variable name alone
                                var execFn = coBind;
                                var execParams = function() {
                                    return [oldLocalGetter($scope)];
                                }

                                // indicate execParams is for a simple execFn and only
                                // returns the variables value
                                execParams.simple = true;
                                
                            } else {
                                // given a function passed to exec like: volume(34, param)
                                // extract out the function name, and the string listing
                                // params. parts[0] is the full string, [1] is fn name,
                                // [2] is params
                                var parts = attrs.exec.match(FUNCTION_RE);
                                parts[2] = parts[2].trim();
                                if (!parts) {
                                    // TODO:: Should possibly be a debug instead
                                    throw 'Invalid exec function. Expected in the form of exec="func(arg1, arg2)" but got exec="' + attrs.exec + '"';
                                }

                                var execFn = parts[1];
                                
                                
                                if (parts[2][0] === '{' || parts[2][0] === '[') {
                                    // Assumes a function with named params / hash or array
                                    var params = [parts[2]];
                                } else {
                                    // given a string of params, extract an array of each of
                                    // the parameters, where params can be literal numbers,
                                    // variable names and single quoted strings
                                    var params = parts[2].match(PARAM_RE);
                                }

                                var execParams = function() {
                                    return params.map(function(param) {
                                        return $scope.$eval(param);
                                    });
                                }
                            }

                            // let the variable we exist (so we can receive success
                            // and error notifications), and tell it how to send
                            // updates to the variable's value
                            if (execFn) {
                                execUnreg = $scope[boundTo].addExec(execFn, execParams, initVal);
                            }
                        };


                    // Bust through any isolated scopes.
                    // Next tick here gives time for values to be defined in parent scopes
                    $timeout(function () {
                        findAndWatch($scope, 'coSystem.id', function (value) {
                            if (value && value.id) {
                                coSystem = value;
                                checkCanBind();
                            } else if (coSystem) {
                                coSystem = null;
                                performUnbind();
                            }
                        }, 'coSystem');

                        findAndWatch($scope, 'coModule', function (value) {
                            coModule = value;
                            checkCanBind();
                        });

                        findAndWatch($scope, 'coIndex', function (value) {
                            coIndex = value;
                            checkCanBind();
                        });


                        // Allows 
                        //  co-bind="'ServerVal' as localVar"
                        // or
                        //  co-bind="'ServerVal'"
                        var expression = attrs.coBind,
                            match = expression.match(COUNT_RE);

                        if (match) {
                            localVar = match[2]

                            $scope.$watch(match[1], function (value) {
                                coBind = value;
                                checkCanBind();
                            });
                        } else {
                            $scope.$watch(attrs.coBind, function (value) {
                                coBind = value;
                                localVar = value;
                                checkCanBind();
                            });
                        }
                    }, 0);

                    // Decrement the binding count when the element goes out of scope
                    $scope.$on('$destroy', function () {
                        performUnbind();
                        if ($scope.hasOwnProperty('coModuleInstance')) {
                            $scope.coModuleInstance.$unbind();
                        }
                    });
                }
            };
        }]);

}(this.angular, this, this.debug));
