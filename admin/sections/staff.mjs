import {buildAdminStaffModel,filterAdminStaffRows} from "../staff-state.mjs";

function element(document,tag,className,text){const node=document.createElement(tag);if(className)node.className=className;if(text!==undefined)node.textContent=String(text);return node}

export async function mount({root,loadAdminStaffData}) {
  const list=root.querySelector("#adminStaffList"),search=root.querySelector("#adminStaffSearch");
  const count=root.querySelector("#adminStaffCount"),updated=root.querySelector("#adminStaffUpdatedAt");
  const refreshButton=root.querySelector("#adminStaffRefreshButton");
  let rows=[],disposed=false,requestVersion=0;

  function render(){
    if(!list||disposed)return;
    list.replaceChildren();
    const filtered=filterAdminStaffRows(rows,search?.value||"");
    if(count)count.textContent=filtered.length+" de "+rows.length+" personas";
    if(!filtered.length){list.append(element(root.ownerDocument,"div","admin-history-empty",rows.length?"No hay personal que coincida con la búsqueda.":"No se encontró personal registrado en la configuración actual."));return}
    for(const person of filtered){
      const card=element(root.ownerDocument,"article","admin-staff-card"),header=element(root.ownerDocument,"header");
      header.append(element(root.ownerDocument,"h4","",person.name),element(root.ownerDocument,"span","admin-staff-role",person.roleLabel));
      card.append(header);
      if(person.carLabel)card.append(element(root.ownerDocument,"p","admin-staff-detail",person.carLabel));
      if(person.statusLabel){const status=element(root.ownerDocument,"p","admin-staff-status",person.statusLabel);if(person.online!==null)status.dataset.online=String(person.online);card.append(status)}
      if(!person.active)card.append(element(root.ownerDocument,"p","admin-staff-detail","Cuenta desactivada"));
      list.append(card);
    }
  }

  async function refresh(){
    const version=++requestVersion;
    if(refreshButton){refreshButton.disabled=true;refreshButton.textContent="Actualizando…"}
    if(count)count.textContent="Consultando personal…";
    try{
      if(typeof loadAdminStaffData!=="function")throw new Error("No está disponible la consulta de personal.");
      const result=await loadAdminStaffData();
      if(disposed||version!==requestVersion||result?.stale)return;
      rows=buildAdminStaffModel(result||{});render();
      if(updated)updated.textContent="Última actualización: "+new Date(result?.loadedAt||Date.now()).toLocaleTimeString("es-AR");
    }catch(error){
      if(!disposed&&version===requestVersion){rows=[];if(count)count.textContent="No se pudo consultar el personal";list?.replaceChildren(element(root.ownerDocument,"div","admin-history-empty","No se pudo cargar el directorio de personal."));if(updated)updated.textContent="Error al actualizar.";console.error("No se pudo cargar el directorio administrativo de personal:",error)}
    }finally{if(refreshButton&&!disposed&&version===requestVersion){refreshButton.disabled=false;refreshButton.textContent="↻ Actualizar"}}
  }

  const onSearch=()=>render(),onRefresh=()=>void refresh();
  search?.addEventListener("input",onSearch);refreshButton?.addEventListener("click",onRefresh);
  await refresh();
  return ()=>{disposed=true;requestVersion++;search?.removeEventListener("input",onSearch);refreshButton?.removeEventListener("click",onRefresh)};
}
