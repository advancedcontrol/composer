(function (angular) {
    'use strict';

    var FUNCTION_RE = /(\w+)\((.+)\)/;
    var PARAM_RE = /([\w\.]+)|('[^']+')/g;

    angular.module('Composer')
        // -----------------------------
        // scopes
        // -----------------------------
        .directive('coSystem', ['$conductor', function($conductor) {
            return {
                restrict: 'A',
                scope: true,
                link: {
                    pre: function($scope, element, attrs) {
                        $scope.coSystem = $conductor.system(attrs.coSystem);
                    }
                }
            };
        }])

        .directive('coModule', function() {
            return {
                restrict: 'A',
                scope: true,
                link: {
                    pre: function($scope, element, attrs) {
                        // store the string name and integer index of a module instance
                        // index may be overwritten by a co-index directive
                        $scope.coModule = attrs.coModule;
                        if (attrs.index)
                            $scope.coIndex = parseInt(attrs.index, 10);
                        else
                            $scope.coIndex = 1;
                    }
                }
            };
        })

        .directive('coIndex', function() {
            return {
                restrict: 'A',
                scope: true,
                link: {
                    pre: function($scope, element, attrs) {
                        $scope.coIndex = parseInt(attrs.coIndex, 10);
                    }
                }
            };
        })


        // -----------------------------
        // widgets
        // -----------------------------
        .directive('coBind', ['$timeout', function($timeout) {
            return {
                restrict: 'A',
                link: function ($scope, element, attrs) {
                    // coIndex defaults to 1 in co-module, and means co-index isn't
                    // a required directive. to avoid instantiating module instances
                    // with index 1 when they're not needed (or are invalid), defer
                    // instantiation to bindings (when we know the final index value)
                    console.log($scope.coSystem);
                    $scope.coModuleInstance = $scope.coSystem.moduleInstance(
                        $scope.coModule,
                        $scope.coIndex
                    );

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
                        var execFn = attrs.coBind;
                        var execParams = function() {
                            return [$scope.statusVariable.val];
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

                    // instantiate or get a reference to the status variable
                    $scope.statusVariable = $scope.coModuleInstance.var(attrs.coBind);

                    // elements can bind to name.val, e.g power.val
                    $scope[attrs.coBind] = $scope.statusVariable;

                    // let the variable we exist (so we can receive success
                    // and error notifications), and tell it how to send
                    // updates to the variable's value
                    //$scope.statusVariable.addObserver();
                    if (execFn)
                        $scope.statusVariable.addExec(execFn, execParams);
                }
            };
        }]);

}(this.angular));
