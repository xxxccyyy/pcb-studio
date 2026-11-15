const booleanFlags=new Set(['--check','--no-stitch','--auto-return','--plan','--no-nb-ripup','--force','--shape-patch','--blind-vias','--no-compact-pairs','--no-joint-reroute','--obstacle-h','--no-obstacle-h','--apply']);
const flagCommands={
  '-o':['place','route','export','device','schem','pour','tune','bom','pos','autopcb','render','import','deliver'],
  '--via-cost':['route','autopcb'],'--max-iter':['route','autopcb'],
  '--iterations':['place','autopcb'],'--anchor':['place','autopcb'],
  '--rounds':['autopcb'],'--devices':['schem'],
  '--net':['pour','drop','pdn'],'--result':['pour','autopcb'],'--layer':['pour'],'--stitch-spacing':['pour'],'--no-stitch':['pour'],
  '--group':['tune'],'--serp-gap':['tune'],'--tol':['tune'],
  '--target':['tune'],'--max-amp':['tune'],
  '--pitch':['thermal'],'--cols':['thermal'],'--rows':['thermal'],
  '--mask':['diffz'],
  '--parallel':['route','autopcb'],'--no-nb-ripup':['route'],'--iter-workers':['route','autopcb'],
  '--iter-waves':['route','autopcb'],'--shard':['route','autopcb'],
  '--shape-patch':['route','autopcb'],'--shape-window':['route','autopcb'],'--shape-nets':['route','autopcb'],
  '--blind-vias':['route','autopcb'],'--fanout-first':['route','autopcb'],
  '--obstacle-h':['route','autopcb'],'--no-obstacle-h':['route','autopcb'],
  '--no-compact-pairs':['route','autopcb'],'--no-joint-reroute':['route','autopcb'],
  '--pair':['tune','diffz'],'--z':['diffz'],
  '--islands':['pour'],'--min-island-area':['pour'],'--fill':['pour'],'--grid-w':['pour'],'--grid-gap':['pour'],
  '--clearance':['pour'],'--edge-margin':['pour'],'--min-width':['pour'],
  '--check':['bom'],'--scale':['render'],'--export':['verify'],'--project':['deliver'],'--force':['deliver'],
  '--current':['drop'],'--entries':['drop'],'--auto-return':['pour'],'--return-reach':['pour'],
  '--vdd':['pdn'],'--itrans':['pdn'],'--ripple':['pdn'],'--dt-us':['pdn'],'--esl-nh':['pdn'],'--cap-uf':['pdn'],'--pkg-lnh':['pdn'],
  '--plan':['pdn'],'--apply':['currents','thermal'],'--plane-pf':['pdn'],'--fmin':['pdn'],'--fmax':['pdn'],'--plan-esl-nh':['pdn']
};
const numericFlags={'--via-cost':[0,100000,false],'--max-iter':[1,1000,true],
  '--iterations':[1,1000000,true],'--rounds':[1,20,true],
  '--scale':[0.1,100,false],'--stitch-spacing':[0.1,1000,false],
  '--current':[0.001,1000,false],
  '--vdd':[0.1,1000,false],'--itrans':[0.001,10000,false],'--ripple':[0.01,100,false],
  '--dt-us':[0.01,100000,false],'--esl-nh':[0.01,100,false],'--cap-uf':[0.0001,10000,false],'--pkg-lnh':[0,1000,false],
  '--min-island-area':[0,1e6,false],'--grid-w':[0.254,10,false],'--grid-gap':[0.254,10,false],
  '--clearance':[0.05,10,false],'--edge-margin':[0,10,false],'--min-width':[0.025,10,false],
  '--serp-gap':[0,50,false],'--tol':[0.001,100,false],
  '--pitch':[0.3,10,false],'--cols':[1,100,true],'--rows':[1,100,true],
  '--mask':[0,1,false],
  '--target':[0,5000,false],'--max-amp':[0,100,false],
  '--z':[1,500,false],'--parallel':[0,64,true],'--iter-workers':[0,64,true],
  '--iter-waves':[1,8,true],'--shard':[0,32,true],
  '--shape-window':[0,100,false]};
export function parseArguments(command,argv){
  const args=[],options=new Map();
  for(let i=0;i<argv.length;i++){
    const token=argv[i];
    if(token==='--'){args.push(...argv.slice(i+1));break;}
    if(!token.startsWith('-')){args.push(token);continue;}
    if(!flagCommands[token]?.includes(command)) throw new Error('Unknown option for '+command+': '+token);
    if(options.has(token)) throw new Error('Duplicate option: '+token);
    if(booleanFlags.has(token)){options.set(token,true);continue;}
    const value=argv[++i];
    if(value==null||value===''||/^--|^-o$/.test(value)) throw new Error('Missing value for '+token);
    if(numericFlags[token]){
      const [min,max,integer]=numericFlags[token],number=Number(value);
      if(!Number.isFinite(number)||number<min||number>max||(integer&&!Number.isInteger(number)))
        throw new Error(token+' must be '+(integer?'an integer':'a number')+' from '+min+' to '+max);
    }
    if(token==='--fanout-first'&&!['off','auto','inner','outer','inner_first','outer_first'].includes(value))
      throw new Error('--fanout-first must be off, auto, inner or outer (inner_first/outer_first also accepted)');
    if(token==='--layer'&&!['top','bottom'].includes(value)) throw new Error('--layer must be top or bottom');
    if(token==='--fill'&&!['solid','grid'].includes(value)) throw new Error('--fill must be solid or grid');
    if(token==='--islands'&&!['always','area','never'].includes(value)) throw new Error('--islands must be always, area or never');
    options.set(token,value);
  }
  return {args,options};
}
