const site=new URLSearchParams(location.search).get('site');
if(site==='outlook'){
  import('./estimated-outlook.js');
} else if (!site || site === 'catalog') {
  import('./linkage-browser.js');
} else if (new URLSearchParams(location.search).get('site') === 'xi') {
  const {requestedXiUnit}=await import('./xi-unit-registry.js');
  if((await requestedXiUnit()).ready)import('./xi-main.js');else import('./xi-unavailable.js');
} else {
  import('./main.js');
}
