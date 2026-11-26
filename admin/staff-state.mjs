const ROLE_ORDER=Object.freeze({admin:0,driver:1,operator:2});
const ROLE_LABELS=Object.freeze({admin:"Administrador",driver:"Chófer",operator:"Operador"});
const CAR_STATUS_LABELS=Object.freeze({libre:"Libre",ocupado:"Ocupado",fuera:"Fuera de servicio",fuera_de_servicio:"Fuera de servicio"});

export function buildAdminStaffModel({staff=[],cars=[]}={}) {
  const carRows=Array.isArray(cars)?cars:Object.values(cars||{});
  const carsById=new Map(carRows.map(car=>[String(car.id),car]));
  return (Array.isArray(staff)?staff:[]).filter(person=>person&&ROLE_LABELS[person.role]).map(person=>{
    const carId=person.carId?String(person.carId):"";
    const car=carId?carsById.get(carId):null;
    const statusLabel=carId?(!car?"Estado del vehículo no disponible":car.online!==true?"Desconectado":CAR_STATUS_LABELS[String(car.status||"").toLowerCase()]||"Estado no identificado")
      :person.role==="driver"?"Sin coche asignado":person.role==="operator"?"Presencia no consultada desde este panel":"";
    return {uid:String(person.uid||""),name:String(person.name||"Personal sin nombre"),role:person.role,roleLabel:ROLE_LABELS[person.role],carId,
      carLabel:carId?"Coche "+carId+(car?.model?" · "+car.model:""):"",statusLabel,online:carId&&car?car.online===true:null,active:person.active!==false};
  }).sort((a,b)=>(ROLE_ORDER[a.role]-ROLE_ORDER[b.role])||a.name.localeCompare(b.name,"es"));
}

export function filterAdminStaffRows(rows,query="") {
  const needle=String(query||"").trim().toLocaleLowerCase("es-AR");
  if(!needle)return Array.isArray(rows)?rows:[];
  return (Array.isArray(rows)?rows:[]).filter(person=>[person.name,person.roleLabel,person.carLabel,person.statusLabel].join(" ").toLocaleLowerCase("es-AR").includes(needle));
}
