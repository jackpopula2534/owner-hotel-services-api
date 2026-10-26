import { GlbValidationError, validateGlb } from './glb-validate';
import { makeGlb } from './glb-test-helpers';

const MESH = { asset: { version: '2.0' }, meshes: [{ primitives: [] }], nodes: [{ mesh: 0 }] };

describe('validateGlb', () => {
  it('accepts a self-contained glTF 2.0 binary', () => {
    expect(validateGlb(makeGlb(MESH))).toEqual({ meshes: 1, nodes: 1 });
    expect(
      validateGlb(
        makeGlb({ ...MESH, images: [{ uri: 'data:image/png;base64,AA' }, { bufferView: 0 }] }),
      ),
    ).toEqual({ meshes: 1, nodes: 1 });
  });

  it('rejects files that are not GLB, the wrong version, or truncated', () => {
    expect(() => validateGlb(Buffer.from('not a model at all, just text'))).toThrow(
      GlbValidationError,
    );
    expect(() => validateGlb(makeGlb(MESH, { version: 1 }))).toThrow(/2\.0/);
    expect(() => validateGlb(makeGlb(MESH).subarray(0, 30))).toThrow(/ไม่ครบ/);
  });

  it('rejects external uris so viewers never fetch from another host', () => {
    expect(() =>
      validateGlb(
        makeGlb({ ...MESH, buffers: [{ uri: 'https://evil.example/a.bin', byteLength: 4 }] }),
      ),
    ).toThrow(/ภายนอก/);
    expect(() => validateGlb(makeGlb({ ...MESH, images: [{ uri: 'texture.png' }] }))).toThrow(
      /ภายนอก/,
    );
  });

  it('rejects compression the viewer cannot decode and empty models', () => {
    expect(() =>
      validateGlb(makeGlb({ ...MESH, extensionsRequired: ['KHR_draco_mesh_compression'] })),
    ).toThrow(/draco/);
    expect(() => validateGlb(makeGlb({ asset: { version: '2.0' } }))).toThrow(/mesh/);
  });
});
