'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';

import { useTranslation } from '@/hooks/useTranslation';
import { useEnv } from '@/context/EnvContext';
import {
  ANIMATION_HEIGHT,
  ANIMATION_SECONDS,
  ANIMATION_WIDTH,
  buildAnimationDocument,
} from '@/services/ai/animation';

interface ClaudeAnimationProps {
  word: string;
  script: string;
}

/**
 * Plays a Claude-written animation in a sandboxed iframe: scripts run, but
 * with an opaque origin, no access to the app and a CSP that blocks network
 * requests. "Save video" asks the frame to record one loop of its canvas.
 */
const ClaudeAnimation: React.FC<ClaudeAnimationProps> = ({ word, script }) => {
  const _ = useTranslation();
  const { appService } = useEnv();
  const frameRef = useRef<HTMLIFrameElement>(null);
  const [recording, setRecording] = useState(false);
  const [error, setError] = useState('');
  const doc = useMemo(() => buildAnimationDocument(script), [script]);

  useEffect(() => {
    const onMessage = async (e: MessageEvent) => {
      if (e.source !== frameRef.current?.contentWindow) return;
      if (e.data?.type === 'record-error') {
        setRecording(false);
        setError(String(e.data.message));
      } else if (e.data?.type === 'recorded' && e.data.blob instanceof Blob) {
        try {
          const blob: Blob = e.data.blob;
          const ext = blob.type.includes('mp4') ? 'mp4' : 'webm';
          const name = `${word.replace(/[^\p{L}\p{N}]+/gu, '-') || 'word'}-animation.${ext}`;
          await appService?.saveFile(name, await blob.arrayBuffer(), {
            mimeType: blob.type.split(';')[0] || 'video/webm',
          });
        } catch (err) {
          setError((err as Error).message);
        } finally {
          setRecording(false);
        }
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [appService, word]);

  const record = () => {
    setError('');
    setRecording(true);
    frameRef.current?.contentWindow?.postMessage(
      { type: 'record', seconds: ANIMATION_SECONDS },
      '*',
    );
  };

  return (
    <div className='mt-2' data-testid='claude-animation'>
      <iframe
        ref={frameRef}
        title={_('Animation of "{{word}}"', { word })}
        sandbox='allow-scripts'
        srcDoc={doc}
        className='eink-bordered w-full rounded-lg'
        style={{ aspectRatio: `${ANIMATION_WIDTH} / ${ANIMATION_HEIGHT}` }}
      />
      <div className='mt-1 flex items-center justify-end gap-2'>
        {error && <span className='text-error me-auto text-xs'>{error}</span>}
        <button
          type='button'
          className='btn btn-ghost btn-xs'
          onClick={record}
          disabled={recording || !appService}
        >
          {recording ? _('Recording…') : _('Save video')}
        </button>
      </div>
    </div>
  );
};

export default ClaudeAnimation;
