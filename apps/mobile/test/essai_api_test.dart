import 'dart:convert';
import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:sabou_mobile/essai_api.dart';

void main() {
  final audio = Uint8List.fromList(List.filled(1000, 7));

  test('envoie la voix avec son format et lit les versions traitées', () async {
    late http.Request sent;
    final api = EssaiApi(
      baseUrl: Uri.parse('http://localhost:3300'),
      client: MockClient((request) async {
        sent = request;
        return http.Response(
          jsonEncode({
            'id': 'abc',
            'receivedBytes': 1000,
            'receivedSeconds': 90.2,
            'versions': [
              {
                'name': 'mi-force',
                'url': '/voix/abc/mi-force.webm',
                'bytes': 268000,
              },
              {
                'name': 'pleine-force',
                'url': '/voix/abc/pleine-force.webm',
                'bytes': 270000,
              },
            ],
          }),
          201,
        );
      }),
    );

    final result = await api.upload(audio, 'audio/ogg');

    expect(sent.method, 'POST');
    expect(sent.url.toString(), 'http://localhost:3300/voix');
    expect(sent.headers['Content-Type'], 'audio/ogg');
    expect(sent.bodyBytes, audio);
    expect(result.sentBytes, 1000);
    expect(result.receivedSeconds, 90.2);
    expect(
      result.versions.first.url.toString(),
      'http://localhost:3300/voix/abc/mi-force.webm',
    );
    expect(result.versions.map((v) => v.bytes), [268000, 270000]);
  });

  test('message en français si le serveur refuse ou ne répond pas', () async {
    EssaiApi apiReplying(int status) => EssaiApi(
      baseUrl: Uri.parse('http://localhost:3300'),
      client: MockClient((_) async => http.Response('{}', status)),
    );
    await expectLater(
      apiReplying(413).upload(audio, 'audio/ogg'),
      throwsA(
        isA<EssaiException>().having(
          (e) => e.message,
          'message',
          contains('trop long'),
        ),
      ),
    );
    await expectLater(
      apiReplying(415).upload(audio, 'audio/ogg'),
      throwsA(
        isA<EssaiException>().having(
          (e) => e.message,
          'message',
          contains('Format'),
        ),
      ),
    );
    final unreachable = EssaiApi(
      baseUrl: Uri.parse('http://localhost:3300'),
      client: MockClient((_) async => throw http.ClientException('refusé')),
    );
    await expectLater(
      unreachable.upload(audio, 'audio/ogg'),
      throwsA(
        isA<EssaiException>().having(
          (e) => e.message,
          'message',
          contains('ne répond pas'),
        ),
      ),
    );
  });
}
