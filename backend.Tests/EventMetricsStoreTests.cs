using MovieCrawler.Backend;
using Xunit;

namespace MovieCrawler.Backend.Tests;

public sealed class EventMetricsStoreTests
{
    [Fact]
    public void Track_Aggregates_Totals_By_Event_And_Item()
    {
        var store = new EventMetricsStore();

        store.Track(new ShareEventRequest
        {
            Name = "share_clicked",
            Payload = new ShareEventPayload
            {
                ItemId = "tt1234567",
                ImdbCode = "tt1234567",
                Method = "copy_link"
            }
        });

        store.Track(new ShareEventRequest
        {
            Name = "share_opened",
            Payload = new ShareEventPayload
            {
                ItemId = "tt1234567",
                ImdbCode = "tt1234567",
                Method = "deep_link"
            }
        });

        var snapshot = store.GetSnapshot();

        Assert.Equal(1, snapshot.Totals["share_clicked"]);
        Assert.Equal(1, snapshot.Totals["share_opened"]);
        Assert.Single(snapshot.Items);
        Assert.Equal(1, snapshot.Items[0].ShareClicked);
        Assert.Equal(1, snapshot.Items[0].ShareOpened);
        Assert.Equal(2, snapshot.RecentEvents.Count);
    }
}
