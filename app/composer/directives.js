(function (angular) {
    'use strict';

    var FUNCTION_RE = /(\w+)\((.+)\)/,
        PARAM_RE = /([\w\.]+)|('[^']+')/g,
        COUNT_RE = /^\s*([\s\S]+?)\s+as\s+([\s\S]+?)\s*$/,

        // Ref: https://developer.mozilla.org/en/docs/Web/JavaScript/Reference/Global_Objects/Object/defineProperty
        WITH_VAL = function (value) {
            return {
                configurable: true,
                enumerable: true,
                value: value,
                writable: true
            };
        };

    angular.module('Composer')

        // Rest API based directives
        .directive('indicesOf', ['System', 'growlNotifications', function(System, growlNotifications) {
            return {
                restrict: 'A',
                link: function ($scope, element, attrs) {
                    var expression = attrs.indicesOf,
                        match = expression.match(COUNT_RE);

                    if (!match) {
                        throw 'Expected in the form of indices-of="moduleType as scopeVar" but got indices-of="' + expression + '"';
                    }

                    var moduleType = match[1],
                        scopeVar = match[2];

                    $scope.$watch('coSystem', function (system) {
                        if (system) {
                            var setCount = function (data) {

                                    // Create an array of indices so we can iterate over them
                                    //  using an ng-repeat for setting module index values
                                    var i,
                                        indices = [];
                                    for (i = 1; i === data.count; i += 1) {
                                        indices.push(i);
                                    }

                                    // On success update the list data
                                    system.$countOf[moduleType] = indices;
                                    $scope[scopeVar] = indices;
                                },
                                loadFailed = function (failed) {
                                    growlNotifications.add(
                                        'Error loading the number of "' + moduleType + '" in system "' + system.$name + '".',
                                        'error'
                                    );
                                };

                            system.$countOf = system.$countOf || {};

                            // Check if cached - avoid hitting the API if we don't need to
                            if (system.$countOf[moduleType]) {

                                // Use the cached value
                                if (system.$countOf[moduleType].hasOwnProperty('then')) {
                                    system.$countOf[moduleType].then(setCount, loadFailed);
                                } else {
                                    $scope[scopeVar] = system.$countOf[moduleType];
                                }
                            } else {

                                // API Request
                                system.$countOf[moduleType] = System.count({
                                    id: system.$name,
                                    module: $scope.$eval(moduleType)
                                }).$promise;
                                system.$countOf[moduleType].then(setCount, loadFailed);
                            }
                        }
                    });
                }
            };
        }])

        .directive('moduleList', ['System', 'growlNotifications', function(System, growlNotifications) {
            return {
                restrict: 'A',
                link: function ($scope, element, attrs) {
                    $scope.$watch('coSystem', function (system) {
                        if (system) {
                            var scopeVar = attrs.moduleList || 'moduleList',
                                setModuleList = function (modList) {
                                    system.$moduleList = modList;
                                    $scope[scopeVar] = modList;
                                },
                                loadFailed = function () {
                                    growlNotifications.add(
                                        'Error loading the list of modules in system "' + $scope.coSystem.$name + '".',
                                        'error'
                                    );
                                };

                            // Check if cached - avoid hitting the API if we don't need to
                            if (system.$moduleList) {

                                // Use the cached value
                                if (system.$moduleList.hasOwnProperty('then')) {
                                    system.$moduleList.then(setModuleList, loadFailed);
                                } else {
                                    $scope[scopeVar] = $scope.coSystem.$moduleList;
                                }
                            } else {

                                // API Request
                                system.$moduleList = System.types({id: system.$name}).$promise;
                                system.$moduleList.then(setModuleList, loadFailed);
                            }
                        }
                    });
                }
            };
        }])


        // -----------------------------
        // scopes
        // -----------------------------
        .directive('coSystem', ['$conductor', function($conductor) {
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
                    // store the string name and integer index of a module instance
                    // index may be overwritten by a co-index directive
                    $scope.$watch(attrs.coModule, function (value) {
                        if (value) {
                            $scope.coModule = value;
                            Object.defineProperty($scope, 'coModule', WITH_VAL(value));
                        }
                    });

                    Object.defineProperty($scope, 'coIndex', WITH_VAL(1));
                    if (attrs.index) {
                        $scope.$watch(attrs.index, function (value) {
                            if (value) {
                                $scope.coIndex = value;
                            }
                        });
                    }
                }
            };
        })

        .directive('coIndex', function() {
            return {
                restrict: 'A',
                scope: true,
                link: function($scope, element, attrs) {
                    $scope.$watch(attrs.coIndex, function (value) {
                        if (value) {
                            Object.defineProperty($scope, 'coIndex', WITH_VAL(value));
                        }
                    });
                }
            };
        })


        // -----------------------------
        // widgets
        // -----------------------------
        .directive('coBind', ['$timeout', function($timeout) {
            return {
                restrict: 'A',
                scope: false,
                link: function ($scope, element, attrs) {
                    var coSystem,
                        coModule,
                        coIndex,
                        coBind,
                        performUnbind = function () {
                            if ($scope.hasOwnProperty('$statusVariable')) {
                                $scope.$statusVariable.unbind();
                            }
                        },
                        pendingCheck,
                        checkCanBind = function () {
                            if (!pendingCheck && coSystem && coModule && coIndex && coBind) {

                                // Timeout as both coModule and coIndex may have changed
                                // we want to wait till the end of the apply cycle
                                pendingCheck = $timeout(function () {
                                    pendingCheck = null;
                                    if (coSystem && coModule && coIndex && coBind) {
                                        performUnbind();
                                        performBinding();
                                    }
                                }, 0, false); // we don't want to trigger another apply
                            }
                        },
                        performBinding = function () {
                            
                            // coIndex defaults to 1 in co-module, and means co-index isn't
                            // a required directive. to avoid instantiating module instances
                            // with index 1 when they're not needed (or are invalid), defer
                            // instantiation to bindings (when we know the final index value)
                            Object.defineProperty($scope, 'coModuleInstance', WITH_VAL(
                                $scope.coSystem.moduleInstance(
                                    coModule,
                                    coIndex
                                )
                            ));

                            // Set the initial value if any
                            var initVal = null;

                            if (attrs.hasOwnProperty('initVal')) {
                                initVal = $scope.$eval(attrs.initVal);
                            }

                            // instantiate or get a reference to the status variable
                            Object.defineProperty($scope, '$statusVariable', WITH_VAL(
                                $scope.coModuleInstance.var(coBind, initVal)
                            ));

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
                                    return [$scope.$statusVariable.val];
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
                                var execFn = parts[1];
                                
                                // given a string of params, extract an array of each of
                                // the parameters, where params can be literal numbers,
                                // variable names and single quoted strings
                                var params = parts[2].match(PARAM_RE);
                                var execParams = function() {
                                    return params.map(function(param) {
                                        return $scope.$eval(param);
                                    });
                                }
                            }

                            // elements can bind to name.val, e.g power.val
                            $scope[coBind] = $scope.$statusVariable;

                            // let the variable we exist (so we can receive success
                            // and error notifications), and tell it how to send
                            // updates to the variable's value
                            if (execFn)
                                $scope.$statusVariable.addExec(execFn, execParams, initVal);

                            
                            // success and error callbacks
                            //$scope.$statusVariable.addObserver(function(statusVariable, msg) {
                                // TODO:: attribute eval with variable
                            //}, function(statusVariable, msg) {
                                // TODO:: attribute eval with variable
                            //});

                            // override default exec throttling if provided
                            if (attrs.hasOwnProperty('maxEps'))
                                $scope.$statusVariable.setMaxExecsPerSecond(attrs.maxEps);
                        };

                    $scope.$watch('coSystem', function (value) {
                        coSystem = value;
                        checkCanBind();
                    });

                    $scope.$watch('coModule', function (value) {
                        coModule = value;
                        checkCanBind();
                    });

                    $scope.$watch('coIndex', function (value) {
                        coIndex = value;
                        checkCanBind();
                    });

                    $scope.$watch(attrs.coBind, function (value) {
                        coBind = value;
                        checkCanBind();
                    });

                    // Decrement the binding count when the element goes out of scope
                    $scope.$on('$destroy', performUnbind);
                }
            };
        }]);

}(this.angular));
