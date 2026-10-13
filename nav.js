(function(){
  var css = ''
    + '#sky-nav{position:sticky;top:0;z-index:40;display:flex;align-items:center;gap:28px;'
    + 'background:rgba(16,19,16,.92);backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);'
    + 'border-bottom:1px solid rgba(220,235,218,.14);padding:0 24px;height:52px;'
    + "font-family:'PPMori',sans-serif;}"
    + '#sky-nav .sn-home svg{height:14px;width:auto;color:#DCEBDA;display:block;}'
    + '#sky-nav a.sn-home{display:flex;align-items:center;margin-right:8px;}'
    + '#sky-nav a.sn-link{font-size:.68rem;font-weight:600;letter-spacing:.16em;text-transform:uppercase;'
    + 'color:#8B8B7E;text-decoration:none;padding:4px 2px;transition:color .15s;}'
    + '#sky-nav a.sn-link:hover{color:#DCEBDA;}'
    + '#sky-nav a.sn-link.active{color:#CAA24B;border-bottom:1px solid #CAA24B;}'
    + '#sky-nav span.sn-soon{font-size:.68rem;font-weight:600;letter-spacing:.16em;text-transform:uppercase;'
    + 'color:rgba(139,139,126,.45);cursor:default;}'
    + '#sky-nav span.sn-soon small{font-size:.52rem;letter-spacing:.1em;margin-left:6px;color:rgba(139,139,126,.6);}'
    + '@media (max-width:560px){#sky-nav{gap:16px;padding:0 16px;overflow-x:auto;}#sky-nav .sn-logo{height:12px;}}';
  var style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);

  var nav = document.createElement('nav');
  nav.id = 'sky-nav';
  nav.innerHTML = '<a class="sn-home" href="/" aria-label="Skymark home"><svg data-name="Layer 3" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 321.22 48.26">   <defs>     <style>       .cls-1 { fill: currentColor; }     </style>   </defs>   <g id="Layer_1" data-name="Layer 1">     <path class="cls-1" d="M74.24,25.01h-22.03v22.64h-5.19V.33h5.19v22.21h21.88c5.76,0,8.42-3.93,8.42-11.18V.33h5.16v10.68c0,6.49-2.12,11.08-7.57,12.76,5.54,1.71,7.72,6.62,7.72,13.2v10.67h-5.19v-11.02c0-7.22-2.63-11.62-8.39-11.62Z"></path>     <path class="cls-1" d="M259.79,25.07h-20.86v22.8h-5.19V.33h28.21c7.88,0,12.6,4.56,12.6,11.81,0,5.48-2.75,10.46-8.42,11.86,5.45,1.27,8.26,5.19,8.26,12.38v11.5h-5.26v-11.57c0-7.82-3.48-11.24-9.34-11.24ZM260.9,22.51c5.1,0,8.33-4.35,8.33-10.18s-3.2-9.34-8.33-9.34h-21.97v19.52h21.97Z"></path>     <path class="cls-1" d="M307.64,25.01h-22.03v22.64h-5.19V.95h5.19v21.59h21.88c5.76,0,8.42-3.93,8.42-11.18V.95h5.16v10.07c0,6.49-2.12,11.08-7.57,12.76,5.54,1.71,7.72,6.62,7.72,13.2v10.67h-5.19v-11.02c0-7.22-2.63-11.62-8.39-11.62Z"></path>     <path class="cls-1" d="M175.83,47.88V10.27c0-4.72-2.69-7.28-7.03-7.28h-5.35v22.08h-5.35V2.99h-5.35c-4.34,0-7.03,2.6-7.03,7.28v37.6h-5.35V10.56c0-6.49,4.08-10.23,11.37-10.23h18.05c7.35,0,11.4,3.74,11.4,10.23v37.32h-5.35Z"></path>     <path class="cls-1" d="M20.65,22.51h-2.49c-3.77,0-7.46-1.45-9.98-4.25-1.48-1.65-2.42-3.64-2.42-6.22,0-4.69,3.1-9.17,7.53-9.17.21,0,.4.02.6.03h13.68c5.08.29,8.1,4.26,8.1,10.17v.28h5.38c0-7.82-5.21-12.83-13.49-13h-13.68c-.14,0-.27-.02-.41-.02C5.82.33.7,4.45.7,11.51c0,4.52,2.14,7.46,5.09,9.78,4.22,3.32,9.51,3.78,14.87,3.78h2.48c3.72,0,7.36,1.35,9.99,3.97,1.92,1.91,3.18,4.27,3.18,7.5,0,4.88-3.39,9.16-8.07,9.16-.23,0-.44.01-.66,0h-13.68c-5.35-.35-8.45-4.91-8.45-10.29v-.19H0c0,7.29,5.36,12.81,13.9,13.02h13.68c.17,0,.33.02.51.02,8.04,0,13.39-4.56,13.39-11.78,0-4.88-2.24-8.05-5.28-10.5-4.38-3.53-9.92-3.48-15.54-3.48Z"></path>     <path class="cls-1" d="M214.44,0h-13.96s-.02,0-.03,0c-8.07,0-13.39,4.72-13.39,13.39v34.49h5.32v-22.8h30.14v22.8h5.35V13.39C227.86,4.73,222.53.01,214.44,0ZM222.51,22.45h-30.14v-10.16c0-6.33,3.23-9.66,8.07-9.66.01,0,.02,0,.03,0h13.96c4.86.01,8.07,3.34,8.07,9.65v10.16Z"></path>     <path class="cls-1" d="M129.19.33v12.46c0,6.33-3.23,9.66-8.07,9.66-.01,0-.02,0-.03,0h-13.96c-4.86-.01-8.07-3.34-8.07-9.65V.33h-5.35v11.35c0,8.66,5.34,13.38,13.42,13.39h4.4v22.81h5.19v-22.81h4.37s.02,0,.03,0c8.07,0,13.39-4.72,13.39-13.39V.33h-5.32Z"></path>   </g> </svg></a>'
    + '<a class="sn-link" data-path="/formats/" href="/formats/">Formats</a>'
    + '<a class="sn-link" data-path="/fotoselectie/" href="/fotoselectie/">Fotoselectie</a>'
    + '<span class="sn-soon">Brandbook<small>binnenkort</small></span>';
  document.body.insertBefore(nav, document.body.firstChild);

  var p = location.pathname;
  nav.querySelectorAll('a.sn-link').forEach(function(a){
    if (p.indexOf(a.getAttribute('data-path')) === 0) a.classList.add('active');
  });
})();
