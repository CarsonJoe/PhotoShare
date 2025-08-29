(function(){
  const ManifestPath = '/app/photos.json';

  async function loadManifest(){
    const url = `${ManifestPath}?v=${Date.now()}`; // bust caches on refresh
    try{
      const res = await fetch(url, { cache: 'no-cache' });
      if(!res.ok) throw new Error(`Failed to load manifest: ${res.status}`);
      const data = await res.json();
      // normalize a bit just in case
      data.groups = Array.isArray(data.groups) ? data.groups : [];
      for(const g of data.groups){
        g.id = g.id || (g.name || '').toLowerCase().replace(/\s+/g,'_');
        g.name = g.name || g.id.replace(/_/g,' ');
        g.photos = Array.isArray(g.photos) ? g.photos : [];
      }
      // sort groups alphabetically by name
      data.groups.sort((a,b)=> a.name.localeCompare(b.name));
      return data;
    }catch(err){
      console.error(err);
      return { groups: [] };
    }
  }

  window.PhotoShare = { loadManifest };
})();

