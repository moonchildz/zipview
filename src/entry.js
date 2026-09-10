if (new URLSearchParams(location.search).get('site') === 'catalog') {
  import('./linkage-browser.js');
} else if (new URLSearchParams(location.search).get('site') === 'xi') {
  const {requestedXiUnit}=await import('./xi-unit-registry.js');
  if(requestedXiUnit().ready)import('./xi-main.js');else import('./xi-unavailable.js');
} else {
  import('./main.js');
}
