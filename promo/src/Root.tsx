import { Composition } from 'remotion';
import { Promo } from './Promo';
import { Graphic } from './Graphic';
import {
  ForgeClip, WorldBossClip, StanceGraphic, DelveGraphic,
  BetsGraphic, PedigreeGraphic, MidnightGraphic,
  ShotCollection, ShotFight,
} from './Spotlights';

export const RemotionRoot: React.FC = () => (<>
  <Composition
    id="Promo"
    component={Promo}
    durationInFrames={900}
    fps={30}
    width={1920}
    height={1080}
  />
  <Composition id="Graphic" component={Graphic} durationInFrames={1} fps={30} width={1600} height={900} />
  <Composition id="GraphicLight" component={Graphic} defaultProps={{ theme: 'light' as const }} durationInFrames={1} fps={30} width={1600} height={900} />
  <Composition id="ForgeClip" component={ForgeClip} durationInFrames={300} fps={30} width={1920} height={1080} />
  <Composition id="WorldBossClip" component={WorldBossClip} durationInFrames={240} fps={30} width={1920} height={1080} />
  {/* stills carry frames so springs and embers settle; render them at --frame=100 */}
  <Composition id="StanceGraphic" component={StanceGraphic} durationInFrames={120} fps={30} width={1600} height={900} />
  <Composition id="DelveGraphic" component={DelveGraphic} durationInFrames={120} fps={30} width={1600} height={900} />
  <Composition id="BetsGraphic" component={BetsGraphic} durationInFrames={120} fps={30} width={1600} height={900} />
  <Composition id="PedigreeGraphic" component={PedigreeGraphic} durationInFrames={120} fps={30} width={1600} height={900} />
  <Composition id="MidnightGraphic" component={MidnightGraphic} durationInFrames={120} fps={30} width={1600} height={900} />
  <Composition id="ShotCollection" component={ShotCollection} durationInFrames={120} fps={30} width={1600} height={900} />
  <Composition id="ShotFight" component={ShotFight} durationInFrames={120} fps={30} width={1600} height={900} />
</>);
