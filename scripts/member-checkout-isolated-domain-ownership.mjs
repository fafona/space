// Pure ownership/lifecycle guard for disposable CI fixtures, never production.
export function assertOwnedDomainContainer(x, c, network, label, nonce) {
  const need = (ok, field) => { if (!ok) throw Error('owned_config_' + field); };
  need(x?.Id === c.id && x.Image === c.image && x.Config?.Labels?.[label] === nonce, 'identity');
  const h = x.HostConfig;
  need(h?.NetworkMode === network.name, 'network_mode');
  need(h.ReadonlyRootfs === true && h.Privileged === false, 'rootfs');
  need(h.Binds === null || (Array.isArray(h.Binds) && h.Binds.length === 0), 'binds');
  need(h.PortBindings === null || (h.PortBindings && Object.keys(h.PortBindings).length === 0), 'ports');
  need(Array.isArray(h.CapDrop) && h.CapDrop.length === 1 && h.CapDrop[0] === 'ALL', 'capabilities');
  need(h.SecurityOpt?.includes('no-new-privileges:true'), 'privileges');
  need(h.PidMode === '' && h.IpcMode !== 'host' && h.UTSMode !== 'host', 'namespaces');
  need(Object.keys(h.Tmpfs ?? {}).sort().join(',') === '/signing,/work', 'tmpfs');
  need((x.Mounts ?? []).every(m => m.Type === 'tmpfs' && ['/work', '/signing'].includes(m.Destination)), 'mounts');
  const networks = x.NetworkSettings?.Networks;
  need(networks && Object.keys(networks).length === 1 && Object.hasOwn(networks, network.name), 'network_membership');
  const endpoint = networks[network.name], running = x.State?.Running;
  need(typeof running === 'boolean', 'state');
  // Docker does not attach the endpoint until start and may detach it on stop.
  // Running fixtures must be attached to the exact owned internal network.
  need(running ? endpoint.NetworkID === network.id : ['', network.id].includes(endpoint.NetworkID), 'network_attachment');
  return x;
}
