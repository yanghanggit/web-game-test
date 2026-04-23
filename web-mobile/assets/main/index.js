System.register("chunks:///_virtual/main",["./MySpriteTest.ts"],(function(){return{setters:[null],execute:function(){}}}));

System.register("chunks:///_virtual/MySpriteTest.ts",["./rollupPluginModLoBabelHelpers.js","cc"],(function(t){var e,r,o,n;return{setters:[function(t){e=t.inheritsLoose},function(t){r=t.cclegacy,o=t._decorator,n=t.Component}],execute:function(){var s;r._RF.push({},"0df895fYB9Jg735P3zxlKpq","MySpriteTest",void 0);var i=o.ccclass;o.property,t("MySpriteTest",i("MySpriteTest")(s=function(t){function r(){return t.apply(this,arguments)||this}e(r,t);var o=r.prototype;return o.start=function(){console.log("Hello MySpriteTest")},o.update=function(t){},r}(n))||s);r._RF.pop()}}}));

(function(r) {
  r('virtual:///prerequisite-imports/main', 'chunks:///_virtual/main'); 
})(function(mid, cid) {
    System.register(mid, [cid], function (_export, _context) {
    return {
        setters: [function(_m) {
            var _exportObj = {};

            for (var _key in _m) {
              if (_key !== "default" && _key !== "__esModule") _exportObj[_key] = _m[_key];
            }
      
            _export(_exportObj);
        }],
        execute: function () { }
    };
    });
});