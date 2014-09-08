ACA Composer
============

ACA Engines UI Language.


## Examples

This example dynamically creates a power toggle button for all the projectors in a room.

```html

<div co-system="'System Name'">
    <div indices-of="'Projector' as projectors" co-module="'Projector'">
        <div ng-repeat="pj in projectors">
            <button co-index="pj" co-bind="'power'" exec ng-click="power = !power">
                Power
                <span ng-if="power">Off</span>
                <span ng-if="!power">On</span>
            </button>
        </div>
    </div>
</div>

```

This lists all the devices that can be controlled in a system

```html

<div co-system="'System Name'">
    <div module-list="modules">
        <div ng-repeat="module in modules">
            <ol indices-of="module as indices">
                <li ng-repeat="index in indices">
                    {{module}}<span> {{index}}</span>
                </li>
            </ol>
        </div>
    </div>
</div>

```

Any function available through ACAs scalable building automation system is exposed in this manner.

So you can build web pages to control your home or workplace with HTML and CSS.
