if (new URLSearchParams(location.search).get('site') === 'xi') {
  import('./xi-main.js');
} else {
  import('./main.js');
}
