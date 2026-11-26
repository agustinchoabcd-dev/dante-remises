function element(document, tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = String(text);
  return node;
}

function formatDate(value) {
  const time = typeof value === "number" ? value : Date.parse(value);
  if (!Number.isFinite(time)) return "Alta: fecha no disponible";
  return "Alta: " + new Date(time).toLocaleDateString("es-AR");
}

export async function mount({ root, loadAdminProfiles }) {
  const list=root.querySelector("#passengerList"), search=root.querySelector("#adminPassengerSearch");
  const count=root.querySelector("#adminPassengerCount"), updated=root.querySelector("#adminPassengerUpdatedAt");
  const refreshButton=root.querySelector("#adminPassengerRefreshButton");
  let profiles=[], disposed=false, requestVersion=0;

  function render() {
    if(!list||disposed)return;
    list.replaceChildren();
    const needle=String(search?.value||"").trim().toLocaleLowerCase("es-AR");
    const filtered=profiles.filter(profile=>[profile.name,profile.lastName,profile.dni,profile.phone].join(" ").toLocaleLowerCase("es-AR").includes(needle));
    if(count)count.textContent=filtered.length+" de "+profiles.length+" pasajeros";
    if(!filtered.length){list.append(element(root.ownerDocument,"div","admin-history-empty",profiles.length?"No hay pasajeros que coincidan con la búsqueda.":"Todavía no hay pasajeros registrados."));return}
    for(const profile of filtered){
      const card=element(root.ownerDocument,"article","admin-passenger-card");
      const header=element(root.ownerDocument,"header");
      const name=[profile.name,profile.lastName].filter(Boolean).join(" ").trim()||"Pasajero sin nombre";
      header.append(element(root.ownerDocument,"h4","",name));
      header.append(element(root.ownerDocument,"span","admin-staff-role",profile.active===false?"Cuenta desactivada":"Cuenta registrada"));
      card.append(header);
      card.append(element(root.ownerDocument,"p","admin-passenger-detail","DNI: "+(profile.dni||"No informado")));
      card.append(element(root.ownerDocument,"p","admin-passenger-detail","Teléfono: "+(profile.phone||"No informado")));
      card.append(element(root.ownerDocument,"p","admin-passenger-detail",formatDate(profile.createdAt)));
      list.append(card);
    }
  }

  async function refresh() {
    const version=++requestVersion;
    if(refreshButton){refreshButton.disabled=true;refreshButton.textContent="Actualizando…"}
    if(count)count.textContent="Consultando perfiles…";
    try{
      if(typeof loadAdminProfiles!=="function")throw new Error("No está disponible la consulta de pasajeros.");
      const result=await loadAdminProfiles();
      if(disposed||version!==requestVersion||result?.stale)return;
      profiles=Array.isArray(result?.profiles)?result.profiles.slice().sort((a,b)=>[a.name,a.lastName].filter(Boolean).join(" ").localeCompare([b.name,b.lastName].filter(Boolean).join(" "),"es")):[];
      render();
      if(updated)updated.textContent="Última actualización: "+new Date(result?.loadedAt||Date.now()).toLocaleTimeString("es-AR");
    }catch(error){
      if(!disposed&&version===requestVersion){
        profiles=[];
        if(count)count.textContent="No se pudieron consultar los perfiles";
        list?.replaceChildren(element(root.ownerDocument,"div","admin-history-empty","No se pudieron cargar los pasajeros. Revisá la conexión y los permisos de lectura."));
        if(updated)updated.textContent="Error al actualizar.";
        console.error("No se pudo cargar el directorio administrativo de pasajeros:",error);
      }
    }finally{
      if(refreshButton&&!disposed&&version===requestVersion){refreshButton.disabled=false;refreshButton.textContent="↻ Actualizar"}
    }
  }

  const onSearch=()=>render(),onRefresh=()=>void refresh();
  search?.addEventListener("input",onSearch);
  refreshButton?.addEventListener("click",onRefresh);
  await refresh();
  return ()=>{
    disposed=true;requestVersion++;
    search?.removeEventListener("input",onSearch);
    refreshButton?.removeEventListener("click",onRefresh);
  };
}
