(function(root){
'use strict';
const configurations=[
 {match:/^(?:przysiad ze sztangą|przysiad goblet z hantlem)$/i,
  label:'Przysiad (widok z boku)',cameraView:'side',
  cameraHint:'Ustaw telefon z boku, około 3 m od siebie, na wysokości bioder. W kadrze muszą być głowa, stopy i pięty.',
  repJoint:{angle:['hip','knee','ankle'],side:'auto'},
  repThresholds:{top:158,bottom:126,minRepMs:1200},
  depthOk:95,depthWarn:110,heelLimit:.02,heelWarn:.035,
  checkpoints:[
   {id:'depth',label:'Głębokość przysiadu',type:'angle',points:['hip','knee','ankle'],
    phase:'bottom',ok:{max:95},warn:{max:110},hint:'Spróbuj zejść niżej, w kontrolowanym zakresie bez bólu.',weight:2},
   {id:'heels',label:'Stabilność pięt',type:'stability',points:['heel','ankle'],
    phase:'whole',ok:{max:.02},warn:{max:.035},
    hint:'Staraj się stabilnie opierać pięty na podłożu.',weight:1}
  ]}
];
function find(exercise){
 const custom=exercise?.formCheck;
 if(custom?.repJoint&&Array.isArray(custom.checkpoints))return custom;
 const name=typeof exercise==='string'?exercise:exercise?.name;
 return configurations.find(c=>c.match.test(String(name||'').trim()))||null;
}
root.FormCheckLibrary=Object.freeze({configurations,find,hasConfig:exercise=>!!find(exercise)});
})(typeof window==='object'?window:globalThis);
