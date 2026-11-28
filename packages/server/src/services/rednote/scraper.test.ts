import {describe, expect, it} from 'vitest';

import {parseRedNotePost} from './scraper.ts';

const externalId = '6a22d82d000000001002d001';
const cdn = 'https://sns-web-i10.rednotecdn.com';
const image = `${cdn}/photo.jpg`;
const secondImage = `${cdn}/second.jpg`;
const video = 'https://sns-v11.rednotecdn.com/video.mp4';
const clips = {h264: [{masterUrl: video, width: 1280}]};

function page(data: object) {
  return `<script>window.__INITIAL_STATE__={"global":{"optional":undefined},"noteData":{"data":{"noteData":${JSON.stringify(
    {
      noteId: externalId,
      type: 'normal',
      title: 'Taipei food',
      desc: 'undefined is a valid string',
      user: {nickName: 'Food guide'},
      time: 1790760330000,
      ...data,
    },
  )}}}};</script>`;
}

describe('RedNote media', () => {
  it('resolves a video and thumbnail to HTTPS CDN URLs', () => {
    const post = parseRedNotePost(
      page({
        type: 'video',
        imageList: [{url: image.replace('https:', 'http:')}],
        video: {
          media: {stream: {h264: [{masterUrl: video.replace('https:', 'http:')}]}},
        },
      }),
      externalId,
    );

    expect(post).toEqual({
      externalId,
      caption: 'Taipei food\n\nundefined is a valid string',
      username: 'Food guide',
      postedAt: '2026-09-30T09:25:30.000Z',
      thumbnailUrl: image,
      media: [{kind: 'video', url: video}],
    });
  });

  it('preserves gallery order across photos and clips and uses stills for Live Photos', () => {
    const post = parseRedNotePost(
      page({
        imageList: [
          {url: image},
          {url: `${cdn}/video-preview.jpg`, stream: clips},
          {url: secondImage, livePhoto: true, stream: clips},
        ],
      }),
      externalId,
    );

    expect(post.media).toEqual([
      {kind: 'image', url: image},
      {kind: 'video', url: video},
      {kind: 'image', url: secondImage},
    ]);
  });

  it('uses the requested note and official media URLs', () => {
    expect(() => parseRedNotePost(page({noteId: 'other'}), externalId)).toThrow(
      'did not return the note',
    );
    expect(() =>
      parseRedNotePost(
        page({
          imageList: [{url: 'https://sns-web-i10.rednotecdn.com.other.example/asset'}],
        }),
        externalId,
      ),
    ).toThrow('no downloadable media');
  });
});
