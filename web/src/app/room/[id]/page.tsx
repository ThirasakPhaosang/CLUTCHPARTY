/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/
"use client";
import { useEffect } from 'react';
import { useRouter, useParams } from 'next/navigation';

export default function RedirectRoomToLobby(){
  const router = useRouter();
  const params = useParams();
  useEffect(()=>{
    const id = params.id as string;
    router.replace(`/room/${id}/lobby`);
  },[router, params]);
  return null;
}
