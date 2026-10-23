import { useEffect, useState } from 'react';

export default function TransferCapabilities() {
  const [message, setMessage] = useState('Checking file storage support…');
  useEffect(() => {
    let disposed = false;
    void (async () => {
      try {
        if (!window.isSecureContext || !navigator.storage?.getDirectory || typeof FileSystemFileHandle === 'undefined' || !FileSystemFileHandle.prototype.createWritable) throw new Error('Receiving files requires a recent browser with temporary disk storage and HTTPS.');
        await navigator.storage.getDirectory();
        const estimate = await navigator.storage.estimate();
        const available = estimate.quota === undefined ? null : Math.max(0, estimate.quota - (estimate.usage ?? 0));
        if (!disposed) setMessage('Temporary file storage is available.' + (available === null ? '' : ' Estimated free quota: ' + (available / 1024 ** 3).toFixed(1) + ' GiB.') + ' Private browsing may enforce a lower limit. Keep both tabs open during transfers.');
      } catch (error) { if (!disposed) setMessage(error instanceof Error ? error.message : 'Browser file storage is unavailable.'); }
    })();
    return () => { disposed = true; };
  }, []);
  return <p className="inline-notice" role="status">{message}</p>;
}