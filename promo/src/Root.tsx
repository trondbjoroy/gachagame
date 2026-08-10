import { Composition } from 'remotion';
import { Promo } from './Promo';
import { Graphic } from './Graphic';

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
</>);
