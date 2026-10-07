import { MongoClient } from 'mongodb';

export async function connectMongo(uri: string) {
  const client = new MongoClient(uri);
  try {
    await client.connect();
    return { client, db: client.db() };
  } catch (error) {
    await client.close();
    throw error;
  }
}
