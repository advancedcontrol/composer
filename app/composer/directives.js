(function (angular) {
    'use strict';

    var FUNCTION_RE = /(\w+)\((.+)\)/;
    var PARAM_RE = /(\w+)|('[^']+')/g;

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
                        $scope.coSystem = $conductor.get(attrs.coSystem);
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
                scope: false,
                link: function ($scope, element, attrs) {
                    var binding = $scope.coSystem.bind($scope.coModule, $scope.coIndex, attrs.coBind);
                    $scope[attrs.coBind] = null;
                    var serverValue = null;

                    binding.add($scope, function(data) {
                        $scope[attrs.coBind] = data;
                        serverValue = data;
                    });

                    // read only scopes have no exec attribute
                    if (!attrs.hasOwnProperty('exec'))
                        return;

                    // when the bound status variable is the same name as the
                    // remote function, and only takes a single param, we can
                    // construct the exec call from the variable name alone
                    if (attrs.exec == '') {
                        var execFn = attrs.coBind;
                        var execParams = function() {
                            return [$scope[attrs.coBind]];
                        }
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

                    $scope.$watch(attrs.coBind, function(newval, oldval) {
                        if ((newval != oldval) && (newval != serverValue))
                            $scope.coSystem.exec($scope.coModule, $scope.coIndex, execFn, execParams());
                    });
                }
            };
        }]);

}(this.angular));
