headers = `200 OK
Content-Type: text/html`

data = `<html>
<head>
        <meta
                http-equiv=refresh
                    content="0;url=client:Fetch?group=DealerDemo&source=wtv-update:/sync%3Fdiskmap%3DDealerDemo&message=Retrieving%20Files..."
        >		
        <display downloadsuccess="client:goback" downloadfail="client:ShowAlert?message=Download%20failed...&buttonlabel1=Okay...&buttonaction1=client:goback&noback=true">
            <title>Retrieving Files</title>
</head>
<body bgcolor=#0 text=#42CC55 fontsize=large hspace=0 vspace=0>
<table cellspacing=0 cellpadding=0>
        <tr>
                <td width=104 height=74 valign=middle align=center bgcolor=3B3A4D>
                        <img src="`+minisrv_config.config.service_logo+`" width=86 height=64>
                <td width=20 valign=top align=left bgcolor=3B3A4D>
                        <spacer>
                <td colspan=2 width=436 valign=middle align=left bgcolor=3B3A4D>
                        <font color=D6DFD0 size=+2><blackface><shadow>
                                <spacer type=block width=1 height=4>
                                <br>
                                        Retrieving Files
                                </shadow>
                                </blackface>
                        </font>
        <tr>
                <td width=104 height=20>
                <td width=20>
                <td width=416>
                <td width=20>
        <tr>
                <td colspan=2>
                <td>
                    <font size=+1>
                        Your Internet terminal is retrieving some files.
                        <p>This may take a while.
                    </font>
        <tr>
                <td colspan=2>
                <td>
                        <br><br>
                        <font color=white>
                        <progressindicator name="downloadprogress"
                           message="Retrieving Files..."
                           height=40 width=250>
                        </font>
</table>
</body>
</html>`