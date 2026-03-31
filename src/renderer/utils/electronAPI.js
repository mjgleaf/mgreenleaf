// Safe wrapper for window.electronAPI that provides no-op fallbacks
// when running in a browser (outside Electron)
const noop = () => Promise.resolve(null);
const noopSync = () => {};

const fallback = new Proxy({}, {
    get(target, prop) {
        // Event listeners should return a cleanup function
        if (prop.startsWith('on')) {
            return (callback) => noopSync;
        }
        return noop;
    }
});

export const getElectronAPI = () => window.electronAPI || fallback;

export default getElectronAPI;
