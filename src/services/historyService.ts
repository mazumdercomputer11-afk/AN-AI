import { 
  collection, 
  doc, 
  addDoc, 
  setDoc, 
  getDocs, 
  getDoc, 
  query, 
  where, 
  orderBy, 
  serverTimestamp,
  updateDoc,
  deleteDoc,
  onSnapshot,
  Timestamp
} from 'firebase/firestore';
import { db, auth } from './firebase';

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
  }
}

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
    },
    operationType,
    path
  }
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

export interface ChatThread {
  id: string;
  title: string;
  userId: string;
  lastMessageAt: any;
  createdAt: any;
  isPinned?: boolean;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  image?: string;
  isImageGeneration?: boolean;
  createdAt: any;
}

export const historyService = {
  async createChat(title: string) {
    const userId = auth.currentUser?.uid;
    if (!userId) throw new Error("User not authenticated");

    const path = 'chats';
    try {
      const docRef = await addDoc(collection(db, path), {
        userId,
        title,
        createdAt: serverTimestamp(),
        lastMessageAt: serverTimestamp()
      });
      return docRef.id;
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, path);
      return null;
    }
  },

  async addMessage(chatId: string, role: 'user' | 'assistant', content: string, extra?: { image?: string, isImageGeneration?: boolean }) {
    const path = `chats/${chatId}/messages`;
    try {
      const messageData: any = {
        role,
        content,
        createdAt: serverTimestamp()
      };

      if (extra?.image) messageData.image = extra.image;
      if (extra?.isImageGeneration !== undefined) messageData.isImageGeneration = extra.isImageGeneration;

      await addDoc(collection(db, path), messageData);
      
      // Update lastMessageAt on chat
      await updateDoc(doc(db, 'chats', chatId), {
        lastMessageAt: serverTimestamp()
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, path);
    }
  },

  getUserChats(userId: string) {
    const path = 'chats';
    try {
      const q = query(
        collection(db, path),
        where('userId', '==', userId)
      );
      return getDocs(q).then(snapshot => {
        return snapshot.docs
          .map(doc => ({ id: doc.id, ...doc.data({ serverTimestamps: 'estimate' }) } as ChatThread))
          .sort((a, b) => {
            const timeA = (a.lastMessageAt as any)?.toMillis?.() || (a.createdAt as any)?.toMillis?.() || 0;
            const timeB = (b.lastMessageAt as any)?.toMillis?.() || (b.createdAt as any)?.toMillis?.() || 0;
            return timeB - timeA;
          });
      });
    } catch (error) {
      console.error('getUserChats error:', error);
      return Promise.resolve([]);
    }
  },

  subscribeToMessages(chatId: string, onUpdate: (messages: ChatMessage[]) => void) {
    const path = `chats/${chatId}/messages`;
    const q = query(collection(db, path), orderBy('createdAt', 'asc'));
    
    return onSnapshot(q, (snapshot) => {
      const messages = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data({ serverTimestamps: 'estimate' }) } as ChatMessage));
      onUpdate(messages);
    }, (error) => {
      console.error('Messages sub error:', error);
    });
  },

  subscribeToChats(userId: string, onUpdate: (threads: ChatThread[]) => void) {
    const path = 'chats';
    const q = query(
      collection(db, path),
      where('userId', '==', userId)
    );
    
    return onSnapshot(q, (snapshot) => {
      const threads = snapshot.docs
        .map(doc => ({ id: doc.id, ...doc.data({ serverTimestamps: 'estimate' }) } as ChatThread))
        .sort((a, b) => {
          // Pin sort first
          if (a.isPinned && !b.isPinned) return -1;
          if (!a.isPinned && b.isPinned) return 1;
          
          const timeA = (a.lastMessageAt as any)?.toMillis?.() || (a.createdAt as any)?.toMillis?.() || 0;
          const timeB = (b.lastMessageAt as any)?.toMillis?.() || (b.createdAt as any)?.toMillis?.() || 0;
          return timeB - timeA;
        });
      onUpdate(threads);
    }, (error) => {
      console.error('Chats sub error:', error);
    });
  },

  async togglePinChat(chatId: string, currentPinStatus: boolean) {
    const path = `chats/${chatId}`;
    try {
      await updateDoc(doc(db, 'chats', chatId), {
        isPinned: !currentPinStatus
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, path);
    }
  },

  async deleteChat(chatId: string) {
    const path = `chats/${chatId}`;
    try {
      // Note: Subcollections are not automatically deleted, but for this demo scale, deleting the thread is enough
      // In production, we'd use a cloud function or batch delete messages too.
      await deleteDoc(doc(db, 'chats', chatId));
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, path);
    }
  }
};
