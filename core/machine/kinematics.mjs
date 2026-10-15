import * as frame from '../geom/frame.mjs';
import * as dimensions from '../dimensions.mjs';
// What a machine extension's kinematics plug (its machine-kinematics entry,
// createKinematics(Kinematics)) receives: Geometry's stateless frame math and
// SAAM's dimension classes. The plug owns every axis of its machine; the
// program writer and the machine view both use it. Gantries need no plug.
export const Kinematics=Object.freeze({frame:Object.freeze({...frame}),dimensions:Object.freeze({...dimensions})});
