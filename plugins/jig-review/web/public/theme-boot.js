/* Generated from jig-core/src/kit/theme-client.ts by scripts/theme-boot.ts. */
(function(){try{
var d="system";
try{var s=document.currentScript&&document.currentScript.src;var q=s?new URL(s).searchParams.get("theme"):null;if(q)d=q}catch(e){}
try{window.__JIG_THEME_DEFAULT__=d}catch(e){}
var c="system";try{c=localStorage.getItem("jig-theme")||d}catch(e){}
if(c!=="light"&&c!=="dark"&&c!=="system")c="system";
var m=window.matchMedia&&window.matchMedia("(prefers-color-scheme: dark)").matches;
var r=c==="system"?(m?"dark":"light"):c;
document.documentElement.dataset.theme=r;
document.documentElement.style.colorScheme=r;
window.__jigThemeChoice=c;
}catch(e){}})();
