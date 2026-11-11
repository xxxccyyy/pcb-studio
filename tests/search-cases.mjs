// Deterministic search fixtures shared by regression and optional before/after validation.
export function searchCases(core){
  const cases=[];
  for(const example of core.EXAMPLES){
    for(const opts of [{}, {diag:false}, {viaCost:17.3,layerDir:false}])
      cases.push({name:example.id+' '+JSON.stringify(opts),design:example.build(),opts});
  }
  for(const layers of [1,2,4]) for(const diag of [false,true]){
    const d=core.designDefaults();
    Object.assign(d,{width:24,height:16,layers,grid:0.5,trackW:0.25,clearance:0.2});
    d.nets=Array.from({length:4},(_,i)=>({id:'n'+i,name:'N'+i}));
    d.nets[0].hs=true; d.nets[1].hs=true;
    d.nets[0].pair='D'; d.nets[1].pair='D'; d.nets[2].w=0.3;
    d.pads=[];
    for(let i=0;i<4;i++) for(let end=0;end<2;end++) d.pads.push({
      id:`p${i}-${end}`,netId:'n'+i,x:end?21.25:2.25,
      y:2.25+(end?3-i:i)*3.5,w:0.8,h:0.8,shape:i%2?'circle':'rect',
      layer:layers===1?'top':(end?'bottom':'top')
    });
    d.keepouts=[{id:'k',x:12,y:8,w:3,h:6}];
    d.manual=[{id:'m',netId:'n2',pts:[{x:5.25,y:12.75,l:0},{x:8.25,y:12.75,l:0}]}];
    cases.push({name:`crossing ${layers}L diag=${diag}`,design:d,opts:{diag,maxIter:5,viaCost:7.5}});
  }
  return cases;
}

export function runSearchCase(core,{design,opts},digest){
  const session=core.createSession(structuredClone(design),opts),stages=[];
  let steps=0;
  while(!session.step().done){ if(++steps>10000) throw new Error('Search did not terminate'); }
  const capture=()=>{
    const {timeMs,...result}=session.buildResult();
    stages.push({status:result.status,iterations:result.iterations,stats:result.stats,
      // Includes exact paths, via order, cell insertion order and occupancy conflicts.
      geometry:digest(JSON.stringify(result))});
  };
  capture();
  const saved=session.snapshot();
  session.optimize(2); capture();
  session.restore(saved);
  session.rerouteSingle(design.nets[0].id); capture();
  return stages;
}
