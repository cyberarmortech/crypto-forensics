// Firebase Configuration
const firebaseConfig = {
    apiKey: "",
    authDomain: "",
    projectId: "",
    storageBucket: "",
    messagingSenderId: "",
    appId: ""
};

// Initialize Firebase with persistence
firebase.initializeApp(firebaseConfig);

// Initialize Firestore with settings
const db = firebase.firestore();
db.settings({
    cacheSizeBytes: firebase.firestore.CACHE_SIZE_UNLIMITED
});

// Enable Firestore persistence
db.enablePersistence()
    .catch((err) => {
        if (err.code === 'failed-precondition') {
            console.log('Multiple tabs open, persistence can only be enabled in one tab at a time.');
        } else if (err.code === 'unimplemented') {
            console.log('The current browser does not support persistence.');
        }
    });

// Initialize Auth with persistence
const auth = firebase.auth();
auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL);

// Configure Google Auth Provider
const googleProvider = new firebase.auth.GoogleAuthProvider();
googleProvider.setCustomParameters({
    prompt: 'select_account'
});

// Make Firebase services available globally
window.db = db;
window.auth = auth;
window.googleProvider = googleProvider;

// Blockchain Configuration
window.blockchainConfig = {
    ethereum: {
        apiKey: '',
        apiUrl: 'https://api.etherscan.io/api',
        explorerUrl: 'https://etherscan.io'
    },
    bitcoin: {
        apiUrl: 'https://blockchain.info',
        explorerUrl: 'https://www.blockchain.com/explorer'
    },
    urlscan: {
        apiUrl: 'https://urlscan.io/api/v1/search/',
        apiKey: ''
    }
};

// Rate Limiting Configuration
window.rateLimits = {
    ethereum: {
        requestsPerSecond: 5,
        requestsPerDay: 100000
    },
    bitcoin: {
        requestsPerSecond: 10,
        requestsPerMinute: 600
    }
};

// Log configuration status
console.log('Firebase initialized');
console.log('Blockchain configuration loaded');
