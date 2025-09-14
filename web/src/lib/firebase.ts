/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/
import { initializeApp, getApps, getApp, FirebaseApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';

// Your web app's Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyAcqsSkb48nQmOOzaqcvgtMK_ihsLIPM80",
  authDomain: "clutchparty-4705c.firebaseapp.com",
  projectId: "clutchparty-4705c",
  storageBucket: "clutchparty-4705c.firebasestorage.app",
  messagingSenderId: "369405569982",
  appId: "1:369405569982:web:147eaaf77f7f707eb967ef",
  measurementId: "G-G54130Z476"
};

// Initialize Firebase
let app: FirebaseApp;
if (!getApps().length) {
  app = initializeApp(firebaseConfig);
} else {
  app = getApp();
}

const auth = getAuth(app);
const db = getFirestore(app);

export { auth, db };
